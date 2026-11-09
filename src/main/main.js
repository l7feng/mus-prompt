'use strict';

// 项目 85 C 阶段 · Electron 主进程
// 职责：开真窗口、只读加载派生数据契约、接收点选配置、调用库外 render.py 导出。
// 词表与规则真源仍是库内 md；本进程不内嵌词表、不写库内文件。

const { app, BrowserWindow, ipcMain } = require('electron');
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

// 从下标 1 起扫描整个 argv：Electron 在不同启动方式下会把应用路径也算进 argv。
const argv = process.argv.slice(1);
function argValue(prefix) {
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}
const CAPTURE_FILE = argValue('--capture=');
const AUTO_EXPORT = argv.includes('--auto-export');
const QUIT_AFTER = argv.includes('--quit-after');

let win = null;
let autoDone = false;

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
  const skeletonOnly = data.models.filter((m) => m.id !== 'suno')
    .every((m) => String(m.status).includes('骨架'));
  const modelOk = data.model.display === 'Suno' && data.model.status === '现役' &&
    data.product_suffix === '-Suno';
  const ok = dataOk && sourceOk && skeletonOnly && modelOk;

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
    skeletonOnly,
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
    icon: path.join(APP_ROOT, 'assets', 'icon.ico'),
    width: 1200,
    height: 920,
    minWidth: 980,
    minHeight: 720,
    title: '配乐提示词生成器 · 项目85 C阶段（Electron 最小窗口）',
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
  win.webContents.on('did-finish-load', () => {
    if (AUTO_EXPORT) win.webContents.send('auto:export');
    else if (QUIT_AFTER) {
      capture((r) => {
        writeLaunchLog({ at: new Date().toISOString(), autoExport: false, capture: r });
        app.quit();
      });
    }
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
