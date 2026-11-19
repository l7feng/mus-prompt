'use strict';

// Electron 主进程
// 职责：开真窗口、只读加载派生数据契约、接收点选配置、调用库外 render.py 导出。
// 词表与规则真源仍是库内 md；本进程不内嵌词表、不写库内文件。

const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const BUILD_DIR = path.join(APP_ROOT, 'build');
const CONFIG_DIR = path.join(APP_ROOT, 'config');
// 本机实值优先：config.local.json（版本库忽略）> config.example.json（只放模板）
const CONFIG_FILE = fs.existsSync(path.join(CONFIG_DIR, 'config.local.json'))
  ? path.join(CONFIG_DIR, 'config.local.json')
  : path.join(CONFIG_DIR, 'config.example.json');
const LOCAL_CFG = (() => {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { return {}; }
})();
// 运行态（selection、launch-log、exports、selfcheck）与源码仓分离，由本机配置或 P85_STATE_HOME 指定。
const STATE_ROOT = path.resolve(LOCAL_CFG.state_home || process.env.P85_STATE_HOME ||
  path.join(APP_ROOT, 'state'));
const RUNTIME_DIR = path.join(STATE_ROOT, '.runtime');
const EXPORT_DIR = path.join(STATE_ROOT, 'exports');
// 界面偏好（页面名称）落运行态，不进库内文件，也不写进 config.local.json。
const UI_FILE = path.join(STATE_ROOT, 'ui.json');
const DEFAULT_PAGE_NAMES = { sop2: 'SOP 一', settings: '设置' };
const PAGE_NAME_MAX = 12;

// 从下标 1 起扫描整个 argv：Electron 在不同启动方式下会把应用路径也算进 argv。
const argv = process.argv.slice(1);
function argValue(prefix) {
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}
const CAPTURE_FILE = argValue('--capture=');
const AUTO_EXPORT = argv.includes('--auto-export');
const QUIT_AFTER = argv.includes('--quit-after');
// 开发自检：--probe=<file> 在页面加载后 dump DOM 断言与渲染进程报错，供 tests/ 冒烟使用。
// 这台机器的 capturePage() 会报 UnknownVizError，截图不可靠，故用 DOM 断言验收。
const PROBE_FILE = argValue('--probe=');

let win = null;
let autoDone = false;
const consoleErrors = [];

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeLaunchLog(obj) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNTIME_DIR, 'launch-log.json'),
    JSON.stringify(obj, null, 2), 'utf8');
}

// data.js 是 JS 赋值语句，用括号配平取回 JSON 主体，不用贪婪正则。
function parseDataJs(text) {
  const marker = 'const P85_DATA = ';
  const i = text.indexOf(marker);
  if (i < 0) throw new Error('data.js 缺少 P85_DATA 赋值');
  const raw = text.slice(i + marker.length);
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let k = 0; k < raw.length; k += 1) {
    const c = raw[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) { end = k + 1; break; }
    }
  }
  if (end < 0) throw new Error('data.js JSON 主体未闭合');
  return JSON.parse(raw.slice(0, end));
}

// D3 甲：构建期哈希 + 启动显示版本；校验不过直接拒绝加载。
function loadContract() {
  const cfg = readJson(CONFIG_FILE);
  const manifest = readJson(path.join(BUILD_DIR, 'manifest.json'));
  const dataPath = path.join(BUILD_DIR, 'data.js');
  const data = parseDataJs(fs.readFileSync(dataPath, 'utf8'));
  const dataSha = sha256(dataPath);
  const declared = (manifest.outputs.find((o) => o.name === 'data.js') || {}).sha256;
  const dataOk = dataSha === declared;

  const vaultRoot = cfg.vault_root;
  const sourceResults = manifest.sources.map((s) => {
    const abs = path.join(vaultRoot, s.path);
    return { role: s.role, path: s.path, ok: fs.existsSync(abs) && sha256(abs) === s.sha256 };
  });
  const sourceOk = sourceResults.every((r) => r.ok);
  // 非 Suno 模型默认不得转「现役」；「骨架／禁生成」「探针实测中」「冻结」同属非现役状态。
  // 状态词用白名单，未知状态一律拒绝（fail-closed），避免真源状态变更被静默放行。
  // 2026-11-09 人类裁决「放宽校验」：允许 SA3「探针实测中（待人类实测回报后转现役）」。
  // 2026-11-10 人类听感裁决：SA3 转「现役（人类听感验收解锁）」、MUS-3 转「冻结（停止生成）」。
  // 2026-11-11 人类裁决：YuE2 转现役（纯器乐轨），同步放行。
  // 仅 SA3 / YuE2 按各自裁决放行「现役」行首；其余模型转现役或出现未知状态仍拒绝。本应用仍只产 Suno 提示词。
  const NON_CURRENT_STATES = ['骨架', '探针实测中', '未实测', '禁生成', '冻结'];
  const RULED_CURRENT = ['stable-audio-3', 'yue2']; // 2026-11-10 SA3 / 2026-11-11 YuE2 裁决解锁
  const nonCurrentOnly = data.models.filter((m) => m.id !== 'suno')
    .every((m) => {
      const s = String(m.status || '');
      // 状态「探针实测中（待人类实测回报后转现役）」含「现役」二字但并非现役声明，
      // 因此只按行首判定；白名单未命中同样拒绝（fail-closed）。
      if (RULED_CURRENT.includes(m.id)) return s.startsWith('现役');
      return !s.startsWith('现役') && NON_CURRENT_STATES.some((k) => s.includes(k));
    });
  const modelOk = data.model.display === 'Suno' && data.model.status === '现役' &&
    data.product_suffix === '-Suno';
  const ok = dataOk && sourceOk && nonCurrentOnly && modelOk;

  return {
    ok,
    data,
    version: data.data_version,
    hashPrefix: dataSha.slice(0, 16),
    dataSha,
    declaredDataSha: declared,
    dataOk,
    sourceOk,
    sourceResults,
    nonCurrentOnly,
    model: {
      display: data.model.display,
      suffix: data.product_suffix,
      status: data.model.status
    },
    skeletonModels: data.models.filter((m) => m.id !== 'suno')
      .map((m) => ({ display: m.display, status: m.status })),
    error: ok ? '' : '真源校验未通过，拒绝加载'
  };
}

ipcMain.handle('contract:load', () => {
  try {
    return loadContract();
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// 页面名称：读本机 ui.json；缺失或坏档一律回默认名，不让界面打不开。
function readPageNames() {
  let stored = {};
  try { stored = readJson(UI_FILE).names || {}; } catch (_) { stored = {}; }
  const out = {};
  Object.keys(DEFAULT_PAGE_NAMES).forEach((k) => {
    const v = typeof stored[k] === 'string' ? stored[k].trim() : '';
    out[k] = (v || DEFAULT_PAGE_NAMES[k]).slice(0, PAGE_NAME_MAX);
  });
  return out;
}

ipcMain.handle('ui:load', () => ({ ok: true, names: readPageNames() }));

ipcMain.handle('ui:save', (_event, payload) => {
  try {
    const incoming = (payload && payload.names) || {};
    const names = {};
    Object.keys(DEFAULT_PAGE_NAMES).forEach((k) => {
      const v = typeof incoming[k] === 'string' ? incoming[k].trim() : '';
      names[k] = (v || DEFAULT_PAGE_NAMES[k]).slice(0, PAGE_NAME_MAX);
    });
    fs.mkdirSync(STATE_ROOT, { recursive: true });
    fs.writeFileSync(UI_FILE, JSON.stringify({ names }, null, 2) + '\n', 'utf8');
    return { ok: true, names };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// SOP 一 词表：唯一真源是 config/sop2-vocab.json（可用 config.local.json 的 sop2_vocab 改指）。
// 界面不内嵌任何词条；整份替换词表后此处按字段做一次结构校验。
function loadSop2Vocab() {
  const errors = [];
  let data = null;
  let file = '';
  try {
    const cfg = readJson(CONFIG_FILE);
    const rel = cfg.sop2_vocab || 'config/sop2-vocab.json';
    file = path.isAbsolute(rel) ? rel : path.join(APP_ROOT, rel);
    data = readJson(file);
  } catch (e) {
    return { ok: false, error: '词表读取失败：' + String(e && e.message ? e.message : e), file, data: null };
  }

  if (!Array.isArray(data.fields) || !data.fields.length) errors.push('fields 为空或缺失');
  const fieldIds = new Set();
  const frags = new Map();
  (Array.isArray(data.fields) ? data.fields : []).forEach((f) => {
    if (!f.id || !f.label) errors.push('字段缺少 id / label：' + JSON.stringify(f.id || null));
    if (fieldIds.has(f.id)) errors.push('字段 id 重复：' + f.id);
    fieldIds.add(f.id);
    const terms = Array.isArray(f.groups)
      ? f.groups.reduce((a, g) => a.concat(Array.isArray(g.terms) ? g.terms : []), [])
      : (Array.isArray(f.terms) ? f.terms : []);
    if (!terms.length) errors.push('字段无词条：' + f.id);
    const seen = new Set();
    terms.forEach((t) => {
      if (!t || !t.en) errors.push('词条缺少 en：' + f.id);
      else if (seen.has(t.en)) errors.push('词条英文重复：' + f.id + ' / ' + t.en);
      else seen.add(t.en);
    });
    frags.set(f.id, seen);
  });

  const templates = Array.isArray(data.templates) ? data.templates : [];
  templates.forEach((tpl) => {
    if (!tpl.cn || !tpl.sel) { errors.push('模板缺少 cn / sel'); return; }
    Object.keys(tpl.sel).forEach((k) => {
      if (!fieldIds.has(k)) errors.push('模板「' + tpl.cn + '」引用了不存在的维度：' + k);
      else (tpl.sel[k] || []).forEach((v) => {
        if (!frags.get(k).has(v)) errors.push('模板「' + tpl.cn + '」词条不在词表：' + k + ' / ' + v);
      });
    });
  });

  const packs = Array.isArray(data.packs) ? data.packs : [];
  packs.forEach((p) => {
    if (!p.cn || !p.instr) errors.push('乐器组合缺少 cn / instr');
  });

  return { ok: errors.length === 0, data, file, errors };
}

ipcMain.handle('sop2:load', () => {
  const r = loadSop2Vocab();
  if (!r.ok) return { ok: false, error: (r.errors && r.errors.length ? r.errors.join('；') : r.error) || '词表校验未通过', file: r.file };
  return { ok: true, data: r.data, file: r.file, version: r.data.version || '' };
});

// SOP 一 导出：只写 state/exports，文件名强制 -Suno.md，已存在不覆盖（序号插在 -Suno 之前）。
ipcMain.handle('sop2:export', (_event, payload) => {
  try {
    const prompt = String((payload && payload.prompt) || '').trim();
    if (!prompt) return { ok: false, error: '提示词为空' };
    if (prompt.length > 8000) return { ok: false, error: '提示词过长' };
    const rawName = String((payload && payload.name) || 'sop2-cue').trim() || 'sop2-cue';
    const name = rawName.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sop2-cue';

    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    let fileName = name + '-Suno.md';
    let n = 2;
    while (fs.existsSync(path.join(EXPORT_DIR, fileName))) {
      fileName = name + '-' + n + '-Suno.md';
      n += 1;
      if (n > 999) return { ok: false, error: '同名文件过多' };
    }
    const version = String((payload && payload.version) || '');
    const cn = String((payload && payload.cn) || '').trim();
    const body = '# ' + name + '\n\n' + prompt + '\n\n' +
      (cn ? '## 中文对照（只读，不进 Style 栏）\n\n' + cn + '\n\n' : '') +
      '<!-- SOP 二 点选生成 · 词表版本 ' + (version || '未知') + ' -->\n';
    fs.writeFileSync(path.join(EXPORT_DIR, fileName), body, 'utf8');
    return { ok: true, product: path.join(EXPORT_DIR, fileName) };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// 导出目录与「一键跟过去」：只认 state/exports 一个位置，界面拿不到任意路径开壳的能力。
ipcMain.handle('export:dir', () => ({ ok: true, dir: EXPORT_DIR }));

ipcMain.handle('export:reveal', async (_event, payload) => {
  try {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const raw = String((payload && payload.file) || '').trim();
    if (!raw) {
      const r = await shell.openPath(EXPORT_DIR);
      return r ? { ok: false, dir: EXPORT_DIR, error: r } : { ok: true, dir: EXPORT_DIR };
    }
    // 只取文件名再拼回导出目录：界面给什么路径都落不进别处。
    const name = path.basename(raw);
    const abs = path.join(EXPORT_DIR, name);
    if (path.dirname(path.resolve(abs)) !== path.resolve(EXPORT_DIR)) {
      return { ok: false, dir: EXPORT_DIR, error: '只能定位导出目录里的文件' };
    }
    if (!fs.existsSync(abs)) {
      return { ok: false, dir: EXPORT_DIR, error: '文件还没生成或在导出目录里找不到：' + name };
    }
    shell.showItemInFolder(abs);
    return { ok: true, dir: EXPORT_DIR, file: abs };
  } catch (e) {
    return { ok: false, dir: EXPORT_DIR, error: String(e && e.message ? e.message : e) };
  }
});

// 设置页：把本机实值一次性交出去（不含任何密钥；令牌只在用户点「查看」时单独读）。
ipcMain.handle('app:info', () => {
  try {
    const cfg = readJson(CONFIG_FILE);
    const py = cfg.python || 'python';
    const pyAbs = path.isAbsolute(py) ? py : path.join(APP_ROOT, py);
    const mcpCfg = cfg.mcp || {};
    const tokenRel = mcpCfg.token_file || 'config/mcp.token';
    const tokenAbs = path.isAbsolute(tokenRel) ? tokenRel : path.join(APP_ROOT, tokenRel);

    let contract;
    try {
      const c = loadContract();
      contract = { ok: c.ok, version: c.version, hashPrefix: c.hashPrefix, error: c.error };
    } catch (e) {
      contract = { ok: false, error: String(e && e.message ? e.message : e) };
    }
    const sop2 = loadSop2Vocab();

    return {
      ok: true,
      appRoot: APP_ROOT,
      musRoot: path.dirname(path.dirname(APP_ROOT)),
      configFile: CONFIG_FILE,
      vaultRoot: cfg.vault_root || '',
      stateRoot: STATE_ROOT,
      exportDir: EXPORT_DIR,
      python: py,
      pythonAbs: pyAbs,
      pythonIsAbsolute: path.isAbsolute(py),
      pythonExists: path.isAbsolute(py) ? fs.existsSync(pyAbs) : null,
      contract,
      sop2: { ok: sop2.ok, file: sop2.file, version: (sop2.data && sop2.data.version) || '', error: sop2.errors ? sop2.errors.join('；') : '' },
      mcp: {
        host: mcpCfg.host || '127.0.0.1',
        port: mcpCfg.port || 8790,
        allowPublic: !!mcpCfg.allow_public,
        tokenFile: tokenAbs,
        tokenExists: fs.existsSync(tokenAbs)
      },
      pages: readPageNames()
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// 只有用户点「查看令牌」才读，不做常驻下发。
ipcMain.handle('mcp:token', () => {
  try {
    const cfg = readJson(CONFIG_FILE);
    const tokenRel = (cfg.mcp && cfg.mcp.token_file) || 'config/mcp.token';
    const tokenAbs = path.isAbsolute(tokenRel) ? tokenRel : path.join(APP_ROOT, tokenRel);
    if (!fs.existsSync(tokenAbs)) {
      return { ok: false, error: '令牌文件还没生成：先双击「启动MCP-本机.cmd」启动一次 HTTP 服务。', file: tokenAbs };
    }
    const token = fs.readFileSync(tokenAbs, 'utf8').trim();
    return { ok: !!token, token, file: tokenAbs, error: token ? '' : '令牌文件为空' };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// 纯器乐锁死文案的快捷复制：只放行白名单常量，不接受渲染进程传入任意文本。
const COPY_WHITELIST = ['[Instrumental]', 'Instrumental'];
ipcMain.handle('clipboard:write', (_event, text) => {
  if (!COPY_WHITELIST.includes(text)) return { ok: false, error: '拒绝复制非白名单文本' };
  clipboard.writeText(text);
  return { ok: true, text };
});

// SOP 一 提示词复制：整段文本，只做长度上限与类型检查。
ipcMain.handle('clipboard:write-text', (_event, text) => {
  const s = typeof text === 'string' ? text : '';
  if (!s.trim()) return { ok: false, error: '文本为空' };
  if (s.length > 8000) return { ok: false, error: '文本过长' };
  clipboard.writeText(s);
  return { ok: true, chars: s.length };
});

ipcMain.handle('export:run', (_event, sel) => new Promise((resolve) => {
  try {
    const cfg = readJson(CONFIG_FILE);
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const selFile = path.join(RUNTIME_DIR, 'selection.json');
    fs.writeFileSync(selFile, JSON.stringify(sel, null, 2), 'utf8');

    const product = '01-界面点选-Suno.md';
    const selfcheckFile = path.join(STATE_ROOT, 'selfcheck.json');
    const script = path.join(APP_ROOT, cfg.render_script || 'scripts/render.py');
    const py = cfg.python || process.env.P85_PYTHON || 'python';
    const args = [script, '--selection', selFile, '--out', EXPORT_DIR,
      '--product', product, '--selfcheck', selfcheckFile, '--stage', 'C'];

    const child = spawn(py, args, { cwd: APP_ROOT, windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (ex) => resolve({
      ok: false, error: String(ex.message), stdout: out.trim(), stderr: err.trim()
    }));
    child.on('close', (code) => {
      let report = null;
      try { report = readJson(selfcheckFile); } catch (_) { /* 自检文件缺失即失败 */ }
      resolve({
        ok: code === 0 && !!report && report.summary.FAIL === 0,
        exitCode: code,
        stdout: out.trim(),
        stderr: err.trim(),
        product: path.join(EXPORT_DIR, product),
        selfcheck: selfcheckFile,
        summary: report ? report.summary : null
      });
    });
  } catch (e) {
    resolve({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}));

async function capture(cb) {
  if (!CAPTURE_FILE || !win) { cb(null); return; }
  try {
    await new Promise((r) => setTimeout(r, 500));
    const img = await win.webContents.capturePage();
    fs.mkdirSync(path.dirname(CAPTURE_FILE), { recursive: true });
    fs.writeFileSync(CAPTURE_FILE, img.toPNG());
    cb(CAPTURE_FILE);
  } catch (e) {
    cb('CAPTURE_FAIL: ' + String(e.message));
  }
}

ipcMain.on('auto:done', (_event, result) => {
  if (autoDone) return;
  autoDone = true;
  capture((captureResult) => {
    writeLaunchLog({
      at: new Date().toISOString(),
      platform: process.platform,
      electron: process.versions.electron,
      autoExport: AUTO_EXPORT,
      exportResult: result || null,
      capture: captureResult,
      note: 'capturePage 为真实 BrowserWindow 渲染内容捕获，不是操作系统屏幕截图'
    });
    if (QUIT_AFTER) app.quit();
  });
});

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(APP_ROOT, 'assets', 'icons', 'app.ico'),
    width: 1200,
    height: 920,
    minWidth: 980,
    minHeight: 720,
    title: 'MUS Prompt',
    backgroundColor: '#16181d',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(APP_ROOT, 'src', 'renderer', 'index.html'));

  // 只收集报错级 console，冒烟里当失败判据用。
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) consoleErrors.push({ level, message: String(message), line, source: String(sourceId) });
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    consoleErrors.push({ level: 3, message: 'render-process-gone ' + JSON.stringify(details) });
  });

  win.webContents.on('did-finish-load', () => {
    if (PROBE_FILE) {
      setTimeout(() => runProbe(), 1200);
      return;
    }
    if (AUTO_EXPORT) win.webContents.send('auto:export');
    else if (QUIT_AFTER) {
      capture((r) => {
        writeLaunchLog({ at: new Date().toISOString(), autoExport: false, capture: r });
        app.quit();
      });
    }
  });
}

// 冒烟探针：把三页结构与生成器状态按契约字段 dump 出来，不依赖截图。
const PROBE_EXPR = `(function () {
  const n = (sel) => document.querySelectorAll(sel).length;
  const el = (id) => document.getElementById(id);
  const snap = () => ({
    prompt: el('aiPrompt') ? String(el('aiPrompt').value).slice(0, 600) : null,
    cnLines: n('#aiPromptCn .cnline'),
    cnHead: el('aiPromptCn') ? String(el('aiPromptCn').textContent).slice(0, 160) : null,
    selRows: n('#aiSelList .selrow'),
    bpm: el('aiBpm') ? el('aiBpm').value : null
  });
  // 版面量尺：中文对照块必须真的可见、不出横向滚动、标签不被截断。
  const measureLayout = () => {
    const cn = el('aiPromptCn');
    return {
      cnVisible: cn ? cn.getBoundingClientRect().height > 0 : false,
      cnHeight: cn ? Math.round(cn.getBoundingClientRect().height) : null,
      cnClientW: cn ? cn.clientWidth : null,
      cnScrollW: cn ? cn.scrollWidth : null,
      cnLabelClipped: cn
        ? Array.from(cn.querySelectorAll('.cnk')).some((s) => s.scrollWidth > s.clientWidth + 1)
        : null,
      bodyClientW: document.body.clientWidth,
      bodyScrollW: document.body.scrollWidth,
      sop2PathH: el('sop2Path') ? Math.round(el('sop2Path').getBoundingClientRect().height) : null
    };
  };
  const out = {
    title: document.title,
    tabs: Array.from(document.querySelectorAll('.pagetab')).map((b) => b.textContent.trim()),
    pages: Array.from(document.querySelectorAll('.page')).map((p) => p.id),
    activePage: (document.querySelector('.page.active') || {}).id || null,
    counts: {
      catNavButtons: n('#aiCatNav .catbtn'),
      termChips: n('#aiTerms .ai-tok'),
      selectedRows: n('#aiSelList .selrow'),
      settingsFields: n('#page-settings input')
    },
    status: el('statusPill') ? el('statusPill').textContent.trim() : null,
    vocab: el('sop2Version') ? el('sop2Version').textContent.trim() : null,
    // 此时 SOP 页在前台，量导出路径条是否真的排出来了。
    sopPathLayout: el('sop2Path') ? {
      h: Math.round(el('sop2Path').getBoundingClientRect().height),
      w: el('sop2Path').clientWidth,
      ellipsis: el('sop2Path').scrollWidth > el('sop2Path').clientWidth
    } : null,
    initial: snap()
  };
  // 交互冒烟：切到「一键模板」-> 点第一个模板 -> 应灌入选择与 BPM。
  const tplTab = document.querySelector('#aiCatNav .catbtn[data-k="templates"]');
  if (tplTab) {
    tplTab.click();
    const tpl = document.querySelector('#aiTerms .ai-tok[data-tpl]');
    if (tpl) {
      tpl.click();
      out.afterTemplate = snap();
      out.templateName = tpl.textContent.trim();
    }
  }
  // 再切回第一个分类，点第一条词条 -> 选择应追加。
  const firstCat = document.querySelector('#aiCatNav .catbtn');
  if (firstCat) {
    firstCat.click();
    const tok = document.querySelector('#aiTerms .ai-tok[data-key]');
    if (tok) {
      tok.click();
      out.afterToken = snap();
      out.tokenName = tok.textContent.trim();
    }
  }
  // SOP 页：中文对照块在页面可见时才量得到尺寸。
  const sop2Tab = document.querySelector('.pagetab[data-page="sop2"]');
  if (sop2Tab) {
    sop2Tab.click();
    out.sopLayout = measureLayout();
  }
  // 设置页：切页后应有路径表、CLI 与 MCP 命令行。
  const stgTab = document.querySelector('.pagetab[data-page="settings"]');
  if (stgTab) {
    stgTab.click();
    out.settings = {
      activePage: (document.querySelector('.page.active') || {}).id || null,
      infoRows: n('#stgInfo dt'),
      cliRows: n('#stgCli .cmd'),
      mcpRows: n('#stgMcp .cmd'),
      firstRow: (document.querySelector('#stgInfo dd') || {}).textContent || null,
      names: [
        el('stgSop2Name') ? el('stgSop2Name').value : null,
        el('stgSettingsName') ? el('stgSettingsName').value : null
      ]
    };
  }
  // 导出冒烟：SOP 二 的「导出 .md」写成异步，主进程稍后再读一次反馈。
  const expBtn = el('aiExportPrompt');
  if (expBtn) {
    expBtn.click();
    out.exportClicked = true;
  }
  // 导出路径条：SOP 页应有一行路径 + 一个「打开目录」。
  out.exportPaths = {
    file: el('sop2Path') ? el('sop2Path').textContent.trim() : null,
    hasFile: el('sop2Path') ? el('sop2Path').classList.contains('has-file') : null,
    openButtons: n('#sop2OpenDir')
  };
  return out;
})()`;

function runProbe() {
  win.webContents.executeJavaScript(PROBE_EXPR, true).then(async (probe) => {
    let exportFeedback = null;
    let exportPathsAfter = null;
    let revealGuard = null;
    if (probe && probe.exportClicked) {
      await new Promise((r) => setTimeout(r, 900));
      exportFeedback = await win.webContents
        .executeJavaScript("(document.getElementById('aiPromptHint')||{}).textContent || null", true)
        .catch(() => null);
      // 导出成功后路径条应换成产物文件名；只用不带文件名的探针调用验守卫，不会真的弹资源管理器。
      exportPathsAfter = await win.webContents
        .executeJavaScript("(function(){var b=document.getElementById('sop2Path');return {file:b?b.textContent.trim():null,hasFile:b?b.classList.contains('has-file'):null};})()", true)
        .catch(() => null);
      revealGuard = await win.webContents
        .executeJavaScript("window.p85.revealExport({file:'不存在的产物.md'})", true)
        .catch((e) => ({ error: String(e && e.message ? e.message : e) }));
    }
    const payload = {
      at: new Date().toISOString(),
      appRoot: APP_ROOT,
      stateRoot: STATE_ROOT,
      electron: process.versions.electron,
      probe,
      exportFeedback,
      exportPathsAfter,
      revealGuard,
      consoleErrors
    };
    try {
      fs.mkdirSync(path.dirname(PROBE_FILE), { recursive: true });
      fs.writeFileSync(PROBE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    } catch (e) {
      consoleErrors.push({ level: 3, message: 'probe write failed: ' + String(e.message) });
    }
    if (QUIT_AFTER) app.quit();
  }).catch((e) => {
    try {
      fs.writeFileSync(PROBE_FILE, JSON.stringify({
        at: new Date().toISOString(),
        appRoot: APP_ROOT,
        probe: null,
        error: String(e && e.message ? e.message : e),
        consoleErrors
      }, null, 2) + '\n', 'utf8');
    } catch (_) { /* 探针自身失败，退出码留给调用方 */ }
    if (QUIT_AFTER) app.quit();
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
