'use strict';

// SOP 一：词条点选生成器。
// 底层逻辑仿 MATRIX WAVE 提示词生成器：字段定义表驱动分类条 → 词条多选/单选 → 参数 →
// 固定句式合成器产出 SUNO 纯配乐提示词。词条一律取自 IPC 送来的词表，界面不含任何词条常量。
// 整文件包在 IIFE 里：经典脚本共享全局词法作用域，避免顶层 const 撞名。

(function sop2Page() {
const esc = (s) => window.musPages.esc(s);
const $ = (id) => document.getElementById(id);

// 顶栏状态灯：词表就位 / 异常。
function setPill(kind, text, note) {
  const el = $('statusPill');
  if (!el) return;
  el.className = 'pill pill-' + kind;
  el.textContent = text;
  if (note) el.title = note;
  else el.removeAttribute('title');
}

let DATA = null;          // 词表（config/sop2-vocab.json）
let FIELD_MAP = new Map(); // id -> field
let CAT = null;           // 当前分类条选中项（字段 id / packs / templates）
let SEARCH = '';
let PROMPT_DIRTY = false;
let PROMPT_TEXT = '';
let SEL = {};             // fieldId -> [{en, cn}]
const PARAMS = { bpm: '', len: '', loop: false, novoc: true, dialogue: false };

const LABEL_PACKS = '乐器组合 Packs';
const LABEL_TEMPLATES = '一键模板';

// 导出路径条：导出 .md 按钮旁显示 state/exports 实值，导出成功后点一下定位到产物。
const exportPathView = window.musPages.mountExportPath('sop2Path', 'sop2OpenDir', (msg) => flash(msg));

function splitLabel(label) {
  const m = String(label || '').match(/^([^A-Za-z]+?)\s*([A-Za-z][A-Za-z0-9 /·&-]*)$/);
  return m ? { cn: m[1].trim(), en: m[2].trim() } : { cn: String(label || ''), en: '' };
}

function fieldTerms(f) {
  if (!f) return [];
  if (Array.isArray(f.groups)) {
    return f.groups.reduce((acc, g) => acc.concat((g.terms || []).map((t) => Object.assign({ group: g.name }, t))), []);
  }
  return (f.terms || []).slice();
}

function getSel(id) { return SEL[id] || (SEL[id] = []); }
function frags(id) { return getSel(id).map((t) => t.en); }

function joinAnd(list) {
  const a = list.filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const artA = (s) => (/^[aeiou]/i.test(s || '') ? 'an ' : 'a ');

// ---- 分类条 ----
function catList() {
  const ids = DATA.fields.map((f) => f.id);
  return ids.concat(['packs', 'templates']);
}

function catLabel(id) {
  if (id === 'packs') return LABEL_PACKS;
  if (id === 'templates') return LABEL_TEMPLATES;
  const f = FIELD_MAP.get(id);
  return f ? f.label : id;
}

function renderCatNav() {
  const nav = $('aiCatNav');
  if (!nav) return;
  const list = catList();
  if (!list.includes(CAT)) CAT = list[0];
  nav.innerHTML = list.map((id) => {
    const sp = splitLabel(catLabel(id));
    return '<button type="button" class="catbtn' + (id === CAT ? ' active' : '') + '" data-k="' + esc(id) + '">' +
      esc(sp.cn) + (sp.en ? '<span class="cen">' + esc(sp.en) + '</span>' : '') + '</button>';
  }).join('');
  nav.querySelectorAll('.catbtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      CAT = btn.dataset.k;
      SEARCH = '';
      if ($('aiSearch')) $('aiSearch').value = '';
      renderCatNav();
      renderTerms();
    });
  });
}

// ---- 词条区 ----
function tokenHtml(fieldId, term) {
  const on = getSel(fieldId).some((t) => t.en === term.en);
  return '<span class="ai-tok' + (on ? ' on' : '') + '" data-key="' + esc(fieldId) + '" data-frag="' + esc(term.en) +
    '" title="' + esc((term.cn || '') + ' / ' + (term.en || '')) + '">' + esc(term.cn || term.en) +
    (term.cn && term.en ? '<span class="en">' + esc(term.en) + '</span>' : '') + '</span>';
}

function renderTerms() {
  const box = $('aiTerms');
  if (!box || !DATA) return;

  if (SEARCH.trim()) {
    const q = SEARCH.trim().toLowerCase();
    let html = '';
    let hits = 0;
    DATA.fields.forEach((f) => {
      const list = fieldTerms(f).filter((t) =>
        String(t.cn || '').toLowerCase().includes(q) || String(t.en || '').toLowerCase().includes(q));
      if (!list.length) return;
      hits += list.length;
      html += '<div class="th">' + esc(f.label) + '</div><div class="tgrid">' +
        list.map((t) => tokenHtml(f.id, t)).join('') + '</div>';
    });
    box.innerHTML = html || '<div class="ai-empty">无匹配词条</div>';
    bindTerms();
    return;
  }

  if (CAT === 'templates') {
    box.innerHTML = '<div class="th">' + esc(LABEL_TEMPLATES) + ' · 点一下灌入整套选择并带出 BPM</div>' +
      '<div class="tgrid">' + (DATA.templates || []).map((t, i) =>
        '<span class="ai-tok preset" data-tpl="' + i + '">' + esc(t.cn) + '</span>').join('') + '</div>' +
      '<p class="ai-empty">模板会写入各分类的选择项，之后可在右侧继续微调。</p>';
    bindTerms();
    return;
  }

  if (CAT === 'packs') {
    box.innerHTML = '<div class="th">' + esc(LABEL_PACKS) + ' · 点一下批量加入乐器</div>' +
      '<div class="tgrid">' + (DATA.packs || []).map((p, i) =>
        '<span class="ai-tok preset" data-preset="' + i + '" title="' + esc(p.instr) + '">＋' + esc(p.cn) + '</span>').join('') + '</div>';
    bindTerms();
    return;
  }

  const field = FIELD_MAP.get(CAT);
  if (!field) { box.innerHTML = '<div class="ai-empty">无此分类</div>'; return; }
  const hint = field.single ? '单选' : '可多选';
  let html = '<div class="th">' + esc(field.label) + '<span class="thsub">' + esc(hint) + '</span></div>';
  if (Array.isArray(field.groups)) {
    field.groups.forEach((g) => {
      html += '<div class="th thgroup">' + esc(g.name) + '</div><div class="tgrid">' +
        (g.terms || []).map((t) => tokenHtml(field.id, t)).join('') + '</div>';
    });
  } else {
    html += '<div class="tgrid">' + (field.terms || []).map((t) => tokenHtml(field.id, t)).join('') + '</div>';
  }
  box.innerHTML = html;
  bindTerms();
}

function bindTerms() {
  const box = $('aiTerms');
  if (!box) return;
  box.querySelectorAll('.ai-tok').forEach((tok) => {
    if (tok.dataset.tpl !== undefined) {
      tok.addEventListener('click', () => applyTemplate(Number(tok.dataset.tpl)));
      return;
    }
    if (tok.dataset.preset !== undefined) {
      tok.addEventListener('click', () => addPack(Number(tok.dataset.preset)));
      return;
    }
    tok.addEventListener('click', () => toggleTerm(tok.dataset.key, tok.dataset.frag));
  });
}

function toggleTerm(fieldId, en) {
  const field = FIELD_MAP.get(fieldId);
  if (!field) return;
  const list = getSel(fieldId);
  const idx = list.findIndex((t) => t.en === en);
  if (idx >= 0) list.splice(idx, 1);
  else {
    if (field.single) list.length = 0;
    const term = fieldTerms(field).find((t) => t.en === en) || { en, cn: en };
    list.push({ en, cn: term.cn || en });
  }
  syncTokens(fieldId);
  renderSel();
  refreshPrompt();
}

function syncTokens(fieldId) {
  document.querySelectorAll('#aiTerms .ai-tok[data-key="' + fieldId + '"]').forEach((tok) => {
    tok.classList.toggle('on', getSel(fieldId).some((t) => t.en === tok.dataset.frag));
  });
}

function addPack(index) {
  const pack = (DATA.packs || [])[index];
  if (!pack) return;
  const list = getSel('instr');
  String(pack.instr).split(/,\s*/).forEach((raw) => {
    const en = raw.trim();
    if (!en || list.some((t) => t.en === en)) return;
    const term = fieldTerms(FIELD_MAP.get('instr')).find((t) => t.en === en);
    list.push({ en, cn: term ? term.cn : en });
  });
  syncTokens('instr');
  renderSel();
  refreshPrompt();
  flash('已加入乐器组合：' + pack.cn);
}

function applyTemplate(index) {
  const tpl = (DATA.templates || [])[index];
  if (!tpl) return;
  SEL = {};
  Object.keys(tpl.sel || {}).forEach((fieldId) => {
    const field = FIELD_MAP.get(fieldId);
    if (!field) return;
    SEL[fieldId] = (tpl.sel[fieldId] || []).map((en) => {
      const term = fieldTerms(field).find((t) => t.en === en);
      return { en, cn: term ? term.cn : en };
    });
  });
  PARAMS.bpm = tpl.bpm != null ? String(tpl.bpm) : '';
  PARAMS.loop = !!tpl.loop;
  PARAMS.dialogue = !!tpl.dialogue;
  PROMPT_DIRTY = false;
  syncParams();
  renderAllTokens();
  renderSel();
  refreshPrompt();
  flash('已套用模板：' + tpl.cn);
}

function syncParams() {
  if ($('aiBpm')) $('aiBpm').value = PARAMS.bpm;
  if ($('aiLen')) $('aiLen').value = PARAMS.len;
  if ($('aiLoop')) $('aiLoop').checked = PARAMS.loop;
  if ($('aiNovoc')) $('aiNovoc').checked = PARAMS.novoc;
  if ($('aiDialog')) $('aiDialog').checked = PARAMS.dialogue;
}

function renderAllTokens() {
  document.querySelectorAll('#aiTerms .ai-tok[data-key]').forEach((tok) => {
    tok.classList.toggle('on', getSel(tok.dataset.key).some((t) => t.en === tok.dataset.frag));
  });
}

// ---- 当前选择 ----
function renderSel() {
  const box = $('aiSelList');
  if (!box) return;
  const rows = DATA.fields.filter((f) => getSel(f.id).length);
  if (!rows.length) {
    box.innerHTML = '<p class="ai-empty">还没有选择 · 在左侧点词条，或上方点模板。</p>';
    return;
  }
  box.innerHTML = rows.map((f) => '<div class="selrow"><div class="selkey"><span>' + esc(f.label) +
    '</span><span class="clr" data-clr="' + esc(f.id) + '">清除本类</span></div><div class="selval">' +
    getSel(f.id).map((t) => '<span class="selchip" data-k="' + esc(f.id) + '" data-frag="' + esc(t.en) + '">' +
      esc(t.cn || t.en) + ' <i>✕</i></span>').join('') + '</div></div>').join('');

  box.querySelectorAll('.clr').forEach((el) => {
    el.addEventListener('click', () => {
      SEL[el.dataset.clr] = [];
      syncTokens(el.dataset.clr);
      renderSel();
      refreshPrompt();
    });
  });
  box.querySelectorAll('.selchip').forEach((el) => {
    el.addEventListener('click', () => {
      const list = getSel(el.dataset.k);
      const idx = list.findIndex((t) => t.en === el.dataset.frag);
      if (idx >= 0) list.splice(idx, 1);
      syncTokens(el.dataset.k);
      renderSel();
      refreshPrompt();
    });
  });
}

// ---- 句式合成：固定骨架，词条只填槽位 ----
function formatPrompt() {
  if (!DATA) return '';
  const usage = frags('usage');
  const era = frags('era');
  const scene = frags('scene');
  const mood = frags('mood');
  const atmosphere = frags('atmosphere');
  const motion = frags('motion');
  const instr = frags('instr');
  const rhythm = frags('rhythm');
  const keymode = frags('keymode');
  const structure = frags('bgmStructure');
  const production = frags('production');
  const ending = frags('ending');

  const out = ['Instrumental only, no vocals, no lyrics.'];

  const p = usage.length ? joinAnd(usage) : 'background score';
  let s1 = cap(artA(p)) + p;
  if (era.length) s1 += ' set in ' + joinAnd(era);
  if (scene.length) s1 += ', during ' + joinAnd(scene);
  out.push(s1 + '.');

  if (mood.length || atmosphere.length) {
    let m = mood.length ? cap(artA(joinAnd(mood))) + joinAnd(mood) + ' mood' : 'An atmospheric mood';
    if (atmosphere.length) m += ', with ' + joinAnd(atmosphere);
    out.push(m + '.');
  }

  if (instr.length) out.push('Featuring ' + joinAnd(instr) + '.');

  const h = motion.concat(production);
  if (rhythm.length) h.push(joinAnd(rhythm));
  if (keymode.length) h.push('in ' + joinAnd(keymode));
  if (PARAMS.bpm.trim()) h.push('around ' + PARAMS.bpm.trim() + ' BPM');
  if (h.length) out.push(cap(h.join(', ')) + '.');

  let tail = structure.length ? cap(joinAnd(structure)) : '';
  if (ending.length) {
    const ed = joinAnd(ending);
    tail += (tail ? ', with ' : 'With ') + artA(ed) + ed + ' ending';
  }
  if (PARAMS.len.trim()) tail += (tail ? ', ' : '') + 'around ' + PARAMS.len.trim() + ' long';
  if (tail) out.push(tail + '.');

  if (PARAMS.loop) out.push('Seamless loop, loopable ending.');

  const dialogueUsage = (DATA.dialogue_usages || []).some((u) => usage.includes(u));
  if (PARAMS.dialogue || dialogueUsage) {
    out.push('Dialogue-friendly, with no strong lead melody, leaving space for narration and dialogue.');
  }

  out.push(PARAMS.novoc
    ? 'No vocals, no lyrics, no singing, no rap, no spoken words, no choir lead, no vocal chops.'
    : 'No vocals, no lyrics, no singing, no rap, no pop chorus, no lead vocal, no EDM drop.');

  return out.join(' ');
}

// ---- 中文对照：与英文同一骨架、同一分支条件，词条取 cn ----
// 只做只读预览：复制与导出仍然只取上面那段英文，这里一个字都不进产物。
function joinCn(list) {
  const a = (list || []).filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  if (a.length === 2) return a[0] + '和' + a[1];
  return a.slice(0, -1).join('、') + '和' + a[a.length - 1];
}

function cnFrags(id) { return getSel(id).map((t) => t.cn || t.en); }

function cnRows() {
  if (!DATA) return [];
  const rows = [];
  const usageCn = cnFrags('usage');
  const eraCn = cnFrags('era');
  const sceneCn = cnFrags('scene');
  const moodCn = cnFrags('mood');
  const atmoCn = cnFrags('atmosphere');
  const instrCn = cnFrags('instr');
  const motionCn = cnFrags('motion');
  const prodCn = cnFrags('production');
  const rhythmCn = cnFrags('rhythm');
  const keyCn = cnFrags('keymode');
  const structCn = cnFrags('bgmStructure');
  const endCn = cnFrags('ending');

  rows.push({ k: '总述', v: '纯器乐，无人声，无歌词。' });

  let t = usageCn.length ? joinCn(usageCn) : '背景配乐';
  if (eraCn.length) t += '，背景设定在' + joinCn(eraCn);
  if (sceneCn.length) t += '，场景为' + joinCn(sceneCn);
  rows.push({ k: '用途 · 时代 · 场景', v: t + '。' });

  let m = moodCn.length ? '整体呈' + joinCn(moodCn) + '氛围' : '整体以氛围铺陈';
  if (atmoCn.length) m += '，空间感是' + joinCn(atmoCn);
  rows.push({ k: '情绪 · 氛围', v: m + '。' });

  if (instrCn.length) rows.push({ k: '乐器', v: joinCn(instrCn) + '。' });

  const bits = [];
  if (motionCn.length) bits.push('镜头感 ' + joinCn(motionCn));
  if (prodCn.length) bits.push('制作 ' + joinCn(prodCn));
  if (rhythmCn.length) bits.push('节奏 ' + joinCn(rhythmCn));
  if (keyCn.length) bits.push('调性 ' + joinCn(keyCn));
  if (PARAMS.bpm.trim()) bits.push('约 ' + PARAMS.bpm.trim() + ' BPM');
  if (bits.length) rows.push({ k: '律动 · 制作 · 参数', v: bits.join('；') + '。' });

  const tail = [];
  if (structCn.length) tail.push('结构 ' + joinCn(structCn));
  if (endCn.length) tail.push('结尾 ' + joinCn(endCn));
  if (PARAMS.len.trim()) tail.push('时长约 ' + PARAMS.len.trim());
  if (tail.length) rows.push({ k: '结构与时长', v: tail.join('；') + '。' });

  if (PARAMS.loop) rows.push({ k: '循环', v: '无缝循环，结尾可循环。' });

  const dialogueUsage = (DATA.dialogue_usages || []).some((u) => frags('usage').includes(u));
  if (PARAMS.dialogue || dialogueUsage) {
    rows.push({ k: '对白友好', v: '不写强主导旋律，为旁白与对白留出空间。' });
  }

  rows.push({
    k: '人声限制',
    v: PARAMS.novoc
      ? '无演唱、无歌词、无说唱、无念白、无合唱主导、无人声切片。'
      : '无演唱、无歌词、无说唱、无流行副歌、无主唱、无电子舞曲高潮段。'
  });

  return rows;
}

function cnPlainText() {
  return cnRows().map((r) => '【' + r.k + '】' + r.v).join('\n');
}

function renderPromptCn() {
  const box = $('aiPromptCn');
  if (!box) return;
  box.innerHTML = cnRows().map((r) =>
    '<p class="cnline"><span class="cnk">' + esc(r.k) + '</span>' + esc(r.v) + '</p>').join('');
  const note = $('aiPromptCnNote');
  if (note) {
    note.textContent = PROMPT_DIRTY
      ? '英文已手改 · 下面按当前词条重新生成，仅作对照'
      : '按当前选择实时生成 · 只读 · 复制与导出仍用上面的英文';
  }
}

function refreshPrompt(force) {
  const box = $('aiPrompt');
  if (force) PROMPT_DIRTY = false;
  if (box && !PROMPT_DIRTY) {
    PROMPT_TEXT = formatPrompt();
    box.value = PROMPT_TEXT;
  }
  renderPromptCn();
}

function flash(text) {
  const hint = $('aiPromptHint');
  if (!hint) return;
  hint.textContent = text;
  window.clearTimeout(flash._t);
  flash._t = window.setTimeout(() => {
    hint.textContent = '复制到 Suno 的 Style of Music / Prompt 栏；BGM 模式不要填 Lyrics。';
  }, 2200);
}

function selectionCount() {
  return DATA.fields.reduce((a, f) => a + getSel(f.id).length, 0);
}

// ---- 事件 ----
function bindEvents() {
  if ($('aiSearch')) {
    $('aiSearch').addEventListener('input', () => {
      SEARCH = $('aiSearch').value;
      renderTerms();
    });
  }
  if ($('aiClearTop')) {
    $('aiClearTop').addEventListener('click', () => {
      SEL = {};
      PARAMS.bpm = '';
      PARAMS.len = '';
      PARAMS.loop = false;
      PARAMS.dialogue = false;
      PARAMS.novoc = true;
      PROMPT_DIRTY = false;
      syncParams();
      renderAllTokens();
      renderSel();
      refreshPrompt(true);
      flash('已清空全部选择');
    });
  }
  if ($('aiCopyTop')) $('aiCopyTop').addEventListener('click', () => copyPrompt());
  if ($('aiCopyPrompt')) $('aiCopyPrompt').addEventListener('click', () => copyPrompt());
  if ($('aiResetPrompt')) {
    $('aiResetPrompt').addEventListener('click', () => {
      refreshPrompt(true);
      flash('已恢复自动生成');
    });
  }
  if ($('aiExportPrompt')) $('aiExportPrompt').addEventListener('click', () => exportPrompt());
  if ($('aiPrompt')) {
    $('aiPrompt').addEventListener('input', () => {
      PROMPT_DIRTY = true;
      PROMPT_TEXT = $('aiPrompt').value;
      renderPromptCn();
    });
  }
  const bindParam = (id, key, isCheck) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener(isCheck ? 'change' : 'input', () => {
      PARAMS[key] = isCheck ? el.checked : el.value;
      refreshPrompt();
    });
  };
  bindParam('aiBpm', 'bpm', false);
  bindParam('aiLen', 'len', false);
  bindParam('aiLoop', 'loop', true);
  bindParam('aiNovoc', 'novoc', true);
  bindParam('aiDialog', 'dialogue', true);
}

async function copyPrompt() {
  const text = $('aiPrompt') ? $('aiPrompt').value.trim() : '';
  if (!text) { flash('提示词为空，没什么可复制'); return; }
  try {
    const r = await window.p85.copyTextAny(text);
    flash(r && r.ok ? '已复制到剪贴板（' + (r.chars || text.length) + ' 字符）' : '复制失败：' + ((r && r.error) || '未知原因'));
  } catch (e) {
    flash('复制失败：' + String(e && e.message ? e.message : e));
  }
}

async function exportPrompt() {
  const text = $('aiPrompt') ? $('aiPrompt').value.trim() : '';
  if (!text) { flash('提示词为空，无法导出'); return; }
  try {
    const r = await window.p85.exportSop2({
      prompt: text,
      cn: cnPlainText(),
      name: pickExportName(),
      version: DATA.version || ''
    });
    flash(r && r.ok
      ? '已导出：' + String(r.product).split(/[\\/]/).pop()
      : '导出失败：' + ((r && r.error) || '未知原因'));
    // 路径条跟着产物走：导出成功点那一行就定位到 .md，失败退回显示导出目录。
    exportPathView.set(r && r.ok ? String(r.product).split(/[\\/]/).pop() : '');
  } catch (e) {
    flash('导出失败：' + String(e && e.message ? e.message : e));
  }
}

// 导出名取「用途+情绪」的中文前两项，便于归档；再回退到 sop2-cue。
function pickExportName() {
  const usage = getSel('usage');
  const mood = getSel('mood');
  const parts = [];
  if (usage.length) parts.push(usage[0].cn || usage[0].en);
  if (mood.length) parts.push(mood[0].cn || mood[0].en);
  const name = parts.join('-').replace(/[\\/:*?"<>|]+/g, '').slice(0, 30);
  return name || 'sop2-cue';
}

async function load() {
  const verEl = $('sop2Version');
  const termsEl = $('aiTerms');
  let r;
  try {
    r = await window.p85.loadSop2();
  } catch (e) {
    r = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  if (!r || !r.ok) {
    setPill('bad', '词表异常', (r && r.error) || '未知原因');
    if (verEl) { verEl.textContent = '词表异常'; verEl.className = 'tag bad-tag'; }
    if (termsEl) termsEl.innerHTML = '<div class="ai-empty">词表加载失败：' + esc((r && r.error) || '未知原因') + '</div>';
    if ($('aiPromptHint')) $('aiPromptHint').textContent = '修好 config/sop2-vocab.json 后重启即可；界面不内嵌词条。';
    return;
  }
  DATA = r.data;
  FIELD_MAP = new Map(DATA.fields.map((f) => [f.id, f]));
  setPill('good', '词表已就位', '词表 ' + (DATA.version || '未标版本'));
  if (verEl) verEl.textContent = '词表 ' + (DATA.version || '未标版本');
  CAT = DATA.fields[0].id;
  renderCatNav();
  renderTerms();
  renderSel();
  bindEvents();
  syncParams();
  refreshPrompt(true);
  if ($('sop2Hint')) {
    $('sop2Hint').textContent = '词表 ' + (DATA.version || '未标版本') + ' ｜ ' +
      DATA.fields.length + ' 个分类 · ' +
      DATA.fields.reduce((a, f) => a + fieldTerms(f).length, 0) + ' 条词条 · ' +
      (DATA.templates || []).length + ' 个模板 · ' + (DATA.packs || []).length + ' 组乐器组合。';
  }
}

load();
})();
