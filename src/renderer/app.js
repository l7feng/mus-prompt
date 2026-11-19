'use strict';

// 页面骨架：两页导航与页面名称。
// 页面名称是界面偏好，落本机运行态（主进程 state/ui.json），不进库内文件。

const PAGE_KEYS = ['sop2', 'settings'];
const DEFAULT_PAGE_NAMES = { sop2: 'SOP 一', settings: '设置' };
const NAME_MAX_LEN = 12;

const pageNames = Object.assign({}, DEFAULT_PAGE_NAMES);
let activePage = 'sop1';

function htmlEsc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function switchPage(key) {
  if (!PAGE_KEYS.includes(key)) return;
  activePage = key;
  PAGE_KEYS.forEach((k) => {
    const page = document.getElementById('page-' + k);
    if (page) page.classList.toggle('active', k === key);
    const tab = document.getElementById('tab-' + k);
    if (tab) {
      tab.classList.toggle('active', k === key);
      tab.setAttribute('aria-selected', k === key ? 'true' : 'false');
    }
  });
  document.dispatchEvent(new CustomEvent('page:change', { detail: { page: key } }));
}

function applyPageNames(names) {
  PAGE_KEYS.forEach((k) => {
    const raw = names && typeof names[k] === 'string' ? names[k].trim() : '';
    pageNames[k] = raw ? raw.slice(0, NAME_MAX_LEN) : DEFAULT_PAGE_NAMES[k];
    const tab = document.getElementById('tab-' + k);
    if (tab) tab.textContent = pageNames[k];
  });
  const nav = document.getElementById('pageNav');
  if (nav) nav.setAttribute('aria-label', '页面切换：' + PAGE_KEYS.map((k) => pageNames[k]).join(' / '));
}

async function bootPages() {
  const nav = document.getElementById('pageNav');
  if (nav) {
    nav.querySelectorAll('.pagetab').forEach((btn) => {
      btn.addEventListener('click', () => switchPage(btn.dataset.page));
    });
  }
  try {
    const r = await window.p85.loadUi();
    if (r && r.ok && r.names) applyPageNames(r.names);
    else applyPageNames(DEFAULT_PAGE_NAMES);
  } catch (_) {
    applyPageNames(DEFAULT_PAGE_NAMES);
  }
  switchPage('sop2');
}

// 设置页保存页面名后即时生效，不用重启。
async function savePageNames(patch) {
  const next = Object.assign({}, pageNames, patch || {});
  PAGE_KEYS.forEach((k) => {
    const raw = typeof next[k] === 'string' ? next[k].trim() : '';
    next[k] = raw ? raw.slice(0, NAME_MAX_LEN) : DEFAULT_PAGE_NAMES[k];
  });
  applyPageNames(next);
  try {
    const r = await window.p85.saveUi({ names: next });
    if (r && r.ok && r.names) applyPageNames(r.names);
    return r;
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ---- 导出路径：显示 state/exports 实值，点路径或「打开目录」都在资源管理器里跟过去 ----
// 路径只有一个真源：主进程 state/exports。界面只认文件名，不给任意路径开壳。
const exportDirCache = { loaded: false, dir: '' };

async function exportDir() {
  if (exportDirCache.loaded) return exportDirCache.dir;
  try {
    const r = await window.p85.exportDir();
    if (r && r.ok) exportDirCache.dir = r.dir || '';
  } catch (_) { /* 读不到就显示占位，不挡住导出 */ }
  exportDirCache.loaded = true;
  return exportDirCache.dir;
}

async function revealExport(file) {
  try {
    return await window.p85.revealExport({ file: file || '' });
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// 挂一块「路径 + 打开目录」：导出成功后 set(文件名)，点一下就地定位到那个文件。
function mountExportPath(pathId, openId, onFail) {
  const pathEl = document.getElementById(pathId);
  const openEl = document.getElementById(openId);
  let file = '';

  const jump = async () => {
    const r = await revealExport(file);
    if ((!r || !r.ok) && onFail) onFail('打开失败：' + ((r && r.error) || '未知原因'));
  };

  if (pathEl) {
    pathEl.setAttribute('role', 'button');
    pathEl.setAttribute('tabindex', '0');
    pathEl.addEventListener('click', jump);
    pathEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
    });
  }
  if (openEl) openEl.addEventListener('click', jump);

  const paint = () => {
    if (!pathEl) return;
    const dir = exportDirCache.dir;
    // 目录显示末尾两段（如 state\exports），完整路径留在 title 里，免得被省略号吃掉。
    const segs = dir ? dir.split(/[\\/]/).filter(Boolean) : [];
    const shortDir = segs.length ? '…\\' + segs.slice(-2).join('\\') : '…';
    pathEl.textContent = file || shortDir;
    pathEl.title = file ? (dir ? dir + '\\' + file : file) : (dir || '');
    pathEl.classList.toggle('has-file', !!file);
  };

  exportDir().then(paint);

  return {
    set(next) { file = next || ''; paint(); },
    refresh() { exportDir().then(paint); }
  };
}

window.musPages = {
  keys: PAGE_KEYS,
  defaults: DEFAULT_PAGE_NAMES,
  names: () => Object.assign({}, pageNames),
  current: () => activePage,
  switch: switchPage,
  apply: applyPageNames,
  save: savePageNames,
  esc: htmlEsc,
  exportDir: exportDir,
  revealExport: revealExport,
  mountExportPath: mountExportPath
};

bootPages();
