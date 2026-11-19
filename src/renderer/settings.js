'use strict';

// 设置页：页面名称、数据与路径、CLI 与 MCP 接入。
// 只做展示与复制；路径与令牌一律由主进程按本机配置读出，界面不拼路径。

(function settingsPage() {
const $ = (id) => document.getElementById(id);
const esc = (s) => window.musPages.esc(s);

let INFO = null;
let CLI_TEXT = '';
let MCP_TEXT = '';

function row(k, v) {
  return '<dt>' + esc(k) + '</dt><dd>' + esc(v == null || v === '' ? '—' : String(v)) + '</dd>';
}

function cmdRow(text, note) {
  return '<div class="cmd">' +
    '<code>' + esc(text) + '</code>' +
    (note ? '<span class="cmdnote">' + esc(note) + '</span>' : '') +
    '<button class="secondary cmd-copy" type="button" data-copy="' + esc(text) + '">复制</button>' +
    '</div>';
}

function bindCopies(container) {
  container.querySelectorAll('.cmd-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const r = await window.p85.copyTextAny(btn.dataset.copy);
        btn.textContent = r && r.ok ? '已复制' : '失败';
      } catch (_) {
        btn.textContent = '失败';
      }
      window.setTimeout(() => { btn.textContent = '复制'; }, 1500);
    });
  });
}

function renderNames(names) {
  $('stgSop2Name').value = names.sop2 || '';
  $('stgSettingsName').value = names.settings || '';
}

function renderInfo() {
  if (!INFO || !INFO.ok) {
    $('stgInfo').innerHTML = row('读取失败', (INFO && INFO.error) || '未知原因');
    return;
  }
  const c = INFO.contract || {};
  const s = INFO.sop2 || {};
  const py = INFO.pythonIsAbsolute
    ? INFO.python + (INFO.pythonExists ? '（已就位）' : '（缺失）')
    : INFO.python + '（系统 PATH）';

  $('stgInfo').innerHTML = [
    row('派生数据版本', c.version),
    row('启动校验', c.ok ? '通过 · 哈希 ' + c.hashPrefix : '未通过 · ' + (c.error || '真源或 data.js 哈希不一致')),
    row('SOP 一 词表', (s.version || '未标版本') + ' · ' + (s.ok ? '结构校验通过' : '校验失败：' + (s.error || ''))),
    row('词表文件', s.file),
    row('应用根目录', INFO.appRoot),
    row('知识库根目录', INFO.vaultRoot),
    row('运行态目录', INFO.stateRoot),
    row('导出目录', INFO.exportDir),
    row('Python', py)
  ].join('');
}

function renderCli() {
  const cli = [];
  const py = INFO.pythonIsAbsolute && INFO.pythonExists ? INFO.python : 'python';
  cli.push('cd /d "' + INFO.appRoot + '"');
  cli.push(py + ' scripts\\cli.py status');
  cli.push(py + ' scripts\\cli.py templates');
  cli.push(py + ' scripts\\cli.py fields --template nrta-cn-drama');
  cli.push(py + ' scripts\\cli.py cues --bucket 01');
  cli.push(py + ' scripts\\cli.py schema');
  cli.push(py + ' scripts\\cli.py resolve --selection selection.json');
  cli.push(py + ' scripts\\cli.py render --selection selection.json --name my-cue');

  const box = $('stgCli');
  box.innerHTML = cli.map((line, i) =>
    cmdRow(line, i === 0 ? '在应用根目录下执行' : '')).join('');
  bindCopies(box);
  CLI_TEXT = cli.join('\n');
}

function renderMcp() {
  const m = INFO.mcp || {};
  const root = INFO.musRoot;
  const lines = [
    ['"' + root + '\\MCP-stdio.cmd"', 'stdio：由 AI 客户端拉起，不要双击'],
    ['"' + root + '\\启动MCP-本机.cmd"', 'HTTP 本机：http://' + m.host + ':' + m.port + '/mcp'],
    ['"' + root + '\\启动MCP-局域网.cmd"', 'HTTP 局域网：绑 0.0.0.0，需放行防火墙私网入站'],
    ['Authorization: Bearer <token>', 'HTTP 客户端请求头；令牌见下'],
    [m.tokenFile, m.tokenExists ? '令牌文件已存在' : '令牌文件未生成（先启动一次 HTTP）']
  ];
  const box = $('stgMcp');
  box.innerHTML = lines.map(([t, note]) => cmdRow(t, note)).join('');
  bindCopies(box);
  MCP_TEXT = lines.map(([t]) => t).join('\n');
}

async function toggleToken() {
  const pre = $('stgTokenValue');
  const msg = $('stgTokenMsg');
  if (!pre.hidden) {
    pre.hidden = true;
    pre.textContent = '';
    $('stgTokenBtn').textContent = '查看令牌';
    return;
  }
  $('stgTokenBtn').disabled = true;
  try {
    const r = await window.p85.loadMcpToken();
    if (r && r.ok) {
      pre.hidden = false;
      pre.textContent = r.token + '\n\n文件：' + r.file;
      $('stgTokenBtn').textContent = '隐藏令牌';
      msg.className = 'copy-feedback';
      msg.textContent = '';
    } else {
      pre.hidden = false;
      pre.textContent = (r && r.error) || '读取失败';
      msg.className = 'copy-feedback fail';
      msg.textContent = '';
    }
  } catch (e) {
    msg.className = 'copy-feedback fail';
    msg.textContent = String(e && e.message ? e.message : e);
  }
  $('stgTokenBtn').disabled = false;
}

async function saveNames() {
  const msg = $('stgNamesMsg');
  const names = {
    sop2: $('stgSop2Name').value,
    settings: $('stgSettingsName').value
  };
  const r = await window.musPages.save(names);
  const ok = r && r.ok;
  msg.className = 'copy-feedback' + (ok ? '' : ' fail');
  msg.textContent = ok ? '已保存' : '保存失败：' + ((r && r.error) || '未知原因');
  if (ok && r.names) renderNames(r.names);
  window.setTimeout(() => { msg.textContent = ''; }, 2000);
}

async function resetNames() {
  const r = await window.musPages.save(window.musPages.defaults);
  if (r && r.ok && r.names) renderNames(r.names);
  const msg = $('stgNamesMsg');
  msg.className = 'copy-feedback' + (r && r.ok ? '' : ' fail');
  msg.textContent = r && r.ok ? '已恢复默认' : '恢复失败：' + ((r && r.error) || '未知原因');
  window.setTimeout(() => { msg.textContent = ''; }, 2000);
}

async function load() {
  try {
    INFO = await window.p85.loadAppInfo();
  } catch (e) {
    INFO = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  renderNames(window.musPages.names());
  renderInfo();
  if (INFO && INFO.ok) {
    renderCli();
    renderMcp();
  }
}

$('stgSaveNames').addEventListener('click', saveNames);
$('stgResetNames').addEventListener('click', resetNames);
$('stgTokenBtn').addEventListener('click', toggleToken);
$('stgCopyAllCli').addEventListener('click', async () => {
  const r = await window.p85.copyTextAny(CLI_TEXT);
  $('stgCopyAllCli').textContent = r && r.ok ? '已复制' : '失败';
  window.setTimeout(() => { $('stgCopyAllCli').textContent = '复制全部命令'; }, 1500);
});
$('stgCopyMcp').addEventListener('click', async () => {
  const r = await window.p85.copyTextAny(MCP_TEXT);
  $('stgCopyMcp').textContent = r && r.ok ? '已复制' : '失败';
  window.setTimeout(() => { $('stgCopyMcp').textContent = '复制 MCP 配置'; }, 1500);
});

load();
})();
