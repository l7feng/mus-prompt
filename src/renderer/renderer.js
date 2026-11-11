'use strict';

// 渲染进程：只读 data.js 派生的词表，收集点选配置，交给主进程调用 render.py。
// 不内嵌任何词表；不允许自由输入自造风格词。

let contract = null;
let activeTemplate = null;
let cardResolution = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function splitWords(s) {
  return String(s).split(/[/、]/).map((x) => x.trim()).filter(Boolean);
}

function setStatus(kind, text) {
  $('statusPill').className = 'pill pill-' + kind;
  $('statusPill').textContent = text;
}

function showResult(text, kind) {
  const box = $('resultBox');
  box.className = 'result' + (kind ? ' ' + kind : '');
  box.textContent = text;
}

function checkedValues(containerId) {
  return Array.from($(containerId).querySelectorAll('input:checked')).map((i) => i.value);
}

function currentCue() {
  if (!contract || !contract.ok) return null;
  const bucket = $('bucket').value;
  const topic = $('topic').value;
  return contract.data.cue_baseline.values.find((r) => r.bucket === bucket && r.topic === topic) || null;
}

// --- S0 题材分流 + S1.5 四字段与取向卡 ---
// 匹配口径与 scripts/render.py 的 resolve_card 保持一致；render.py 会复核 card_id。

function themeRegistry() {
  return contract.data.theme_templates.values;
}

function normRule(v) {
  return String(v) === '写实' ? '现实写实' : String(v);
}

function eraOverlap(cardEra, selectedEra) {
  if (cardEra === selectedEra) return true;
  const a = String(cardEra).replace(/–/g, '-').split('-').map((x) => x.trim()).filter(Boolean);
  const b = String(selectedEra).replace(/–/g, '-').split('-').map((x) => x.trim()).filter(Boolean);
  if (a.length === 1 && b.length === 1) return false;
  return a.some((x) => b.includes(x));
}

function resolveCard(tpl, fields) {
  if (!tpl) return { card: null, override: false, candidates: 0 };
  if (tpl.id === 'nrta-cn-drama') {
    const era = fields.era || '';
    const anchor = fields.anchor || '';
    const short = anchor.startsWith(era) ? anchor.slice(era.length) : anchor;
    const key = era + '·' + short.replace(/题材$/, '');
    const rule = normRule(fields.rule || '');
    const timbre = fields.timbre || '';
    const cand = tpl.cards.filter((c) =>
      c.match.theme_keys.includes(key) && c.match.rule.includes(rule));
    const exact = cand.find((c) => c.match.timbre.includes(timbre));
    if (exact) return { card: exact, override: false, candidates: cand.length };
    if (timbre !== '无特定') {
      const fallback = cand.find((c) => c.match.timbre.includes('无特定'));
      if (fallback) return { card: fallback, override: true, candidates: cand.length };
    }
    return { card: null, override: false, candidates: cand.length };
  }
  const genres = [fields.genre_primary, fields.genre_secondary].filter(Boolean);
  const rule = normRule(fields.rule || '');
  const cand = tpl.cards.filter((c) =>
    c.match.genre_keys.some((g) => genres.includes(g)) &&
    eraOverlap(c.match.era, fields.era || '') &&
    c.match.rule.includes(rule) &&
    c.match.timbre.includes(fields.timbre || ''));
  const primary = cand.filter((c) => c.match.genre_keys.includes(fields.genre_primary));
  const pick = primary.length ? primary : cand;
  return { card: pick[0] || null, override: false, candidates: pick.length };
}

function fillS15Options(f) {
  const sel = $('s15-' + f.key);
  if (!sel) return;
  let opts;
  if (f.depends_on) {
    const parent = $('s15-' + f.depends_on);
    opts = (f.options_by || {})[parent ? parent.value : ''] || [];
  } else {
    opts = f.options || [];
  }
  const current = sel.value;
  sel.innerHTML = (f.allow_empty
    ? '<option value="">' + esc(f.empty_label || '无') + '</option>' : '') +
    opts.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
  if (opts.includes(current)) sel.value = current;
  else if (f.allow_empty) sel.value = '';
  else if (opts.length) sel.value = opts[0];
}

function applyS15Defaults() {
  const defaults = activeTemplate.default_s15 || {};
  activeTemplate.fields.filter((f) => !f.depends_on).forEach((f) => {
    fillS15Options(f);
    const sel = $('s15-' + f.key);
    const v = defaults[f.key];
    if (v !== undefined && Array.from(sel.options).some((o) => o.value === v)) sel.value = v;
  });
  activeTemplate.fields.filter((f) => f.depends_on).forEach((f) => {
    fillS15Options(f);
    const sel = $('s15-' + f.key);
    const v = defaults[f.key];
    if (v !== undefined && Array.from(sel.options).some((o) => o.value === v)) sel.value = v;
  });
  updateThemeCard();
}

function renderS15Fields() {
  const wrap = $('s15Fields');
  wrap.innerHTML = activeTemplate.fields.map((f) =>
    '<div class="field"><label for="s15-' + esc(f.key) + '">' + esc(f.label) +
    '</label><select id="s15-' + esc(f.key) + '"></select></div>').join('');
  activeTemplate.fields.forEach((f) => {
    $('s15-' + f.key).addEventListener('change', () => onS15Change(f.key));
  });
  applyS15Defaults();
}

function onS15Change(key) {
  if (key === 'genre_primary' || key === 'genre_secondary') {
    const p = $('s15-genre_primary');
    const s = $('s15-genre_secondary');
    if (p && s && s.value && s.value === p.value) s.value = '';
  }
  activeTemplate.fields.filter((f) => f.depends_on === key).forEach(fillS15Options);
  updateThemeCard();
}

function readS15() {
  const out = {};
  activeTemplate.fields.forEach((f) => { out[f.key] = $('s15-' + f.key).value; });
  return out;
}

function updateThemeCard() {
  cardResolution = resolveCard(activeTemplate, readS15());
  const box = $('cardResult');
  const card = cardResolution.card;
  box.className = 'theme-card ' + (card ? (cardResolution.override ? 'warn' : 'ok') : 'bad');
  if (!card) {
    box.innerHTML = '<h3>未命中取向卡</h3>' +
      '<p class="bad-text">按模板未命中规则，无卡不生成；请调整四字段组合，或在该模板登记「待补卡」。' +
      (activeTemplate.verified ? '' : ' 本模板卡集尚未实测验收。') + '</p>';
    $('exportBtn').disabled = true;
    return;
  }
  box.innerHTML = '<h3>取向卡命中 · ' + esc(card.anchor) + '</h3>' +
    '<dl>' +
    '<dt>音阶调式</dt><dd>' + esc(card.scale) + '</dd>' +
    '<dt>主奏乐器</dt><dd>' + esc(card.instruments) + '</dd>' +
    '<dt>织体空间</dt><dd>' + esc(card.texture) + '</dd>' +
    '<dt>排除项</dt><dd>' + esc(card.excludes) + '</dd>' +
    '</dl>' +
    (cardResolution.override
      ? '<p class="warn-text">音色域覆盖：卡默认「无特定」主奏降级为参考，按项目 S0 乐器口径执行。</p>'
      : '') +
    (!activeTemplate.verified
      ? '<p class="warn-text">该模板卡集未实测验收，仅作参考。</p>'
      : '');
  $('exportBtn').disabled = false;
}

function renderTemplate() {
  const reg = themeRegistry();
  activeTemplate = reg.templates.find((t) => t.id === $('templateId').value) || reg.templates[0];
  const badges = [];
  if (activeTemplate.default) badges.push('<span class="badge good">默认</span>');
  badges.push('<span class="badge ' + (activeTemplate.verified ? 'good' : 'warn') + '">' +
    esc(activeTemplate.status) + '</span>');
  badges.push('<span class="badge">' + activeTemplate.cards.length + ' 张取向卡</span>');
  $('templateBadge').innerHTML = badges.join('');
  const c = activeTemplate.coverage;
  const all = reg.coverage;
  $('coverageLine').textContent =
    '本模板：' + c.total + ' 个一级题材 · ' + c.with_card + ' 个有卡 · ' + c.cards +
    ' 张卡 · ' + c.gaps + ' 个缺口' +
    (c.real_gaps !== undefined ? '（实际需补 ' + c.real_gaps + '）' : '') +
    '｜全库合计：' + all.themes + ' 个题材 · ' + all.with_card + ' 个有卡 · ' +
    all.real_gaps + ' 个实缺（' + all.gaps + ' 个缺口，含兜底位）';
  $('templateNote').textContent = activeTemplate.note || '';
  renderS15Fields();
}

function initTheme(data) {
  const reg = data.theme_templates.values;
  $('templateId').innerHTML = reg.templates.map((t) =>
    '<option value="' + esc(t.id) + '">' + esc(t.name) +
    (t.default ? '（默认）' : '') + '</option>').join('');
  $('templateId').value = reg.default;
  renderTemplate();
}

function fillContract(c) {
  $('cVersion').textContent = c.version;
  $('cHash').textContent = c.hashPrefix;
  $('cModel').textContent = c.model.display + ' · ' + c.model.status;
  $('cSuffix').textContent = c.model.suffix;
  const okCount = c.sourceResults.filter((r) => r.ok).length;
  $('cSources').textContent = okCount + '/' + c.sourceResults.length +
    (c.dataOk ? ' · data.js 哈希一致' : ' · data.js 哈希不一致');
}

function onTopicChange() {
  const row = currentCue();
  if (!row) return;
  $('instruments').value = row.instruments;
  $('bpm').value = row.bpm;
  $('duration').value = row.duration;

  const bucketRow = contract.data.suno_mood_by_bucket.values.find((r) => r.bucket === row.bucket);
  const primary = bucketRow ? splitWords(bucketRow.primary) : [];
  const selected = splitWords(row.mood_words);
  const ordered = selected.concat(primary.filter((w) => !selected.includes(w)));
  // 首轮最小窗口：情绪词随 cue 只读派生；自定义词组与跨桶改判依据留 C 后续轮次。
  $('moodWords').innerHTML = ordered.map((w) =>
    '<label><input type="checkbox" value="' + esc(w) + '"' +
    (selected.includes(w) ? ' checked' : '') + ' disabled>' + esc(w) + '</label>').join('');
}

function primaryOf(bucket) {
  const row = contract.data.suno_mood_by_bucket.values.find((r) => r.bucket === bucket);
  return row ? splitWords(row.primary) : [];
}

function onBucketChange() {
  const bucket = $('bucket').value;
  const rows = contract.data.cue_baseline.values.filter((r) => r.bucket === bucket);
  $('topic').innerHTML = rows.map((r) =>
    '<option value="' + esc(r.topic) + '">' + esc(r.topic) + ' · ' + esc(r.use) + '</option>').join('');
  // 默认选第一条「情绪词全部主归本桶」的 cue，避开需留改判依据的跨桶词。
  const preferred = rows.find((r) => splitWords(r.mood_words)
    .every((w) => primaryOf(r.bucket).includes(w))) || rows[0];
  if (preferred) $('topic').value = preferred.topic;
  onTopicChange();
}

function initForm(data) {
  initTheme(data);
  $('bucket').innerHTML = data.buckets.values.map((b) =>
    '<option value="' + esc(b.id) + '">' + esc(b.id) + ' · ' + esc(b.target) + '</option>').join('');
  $('negativeGroups').innerHTML = ['A', 'B', 'C', 'D', 'E'].map((g) =>
    '<label><input type="checkbox" value="' + g + '"' +
    (g === 'A' || g === 'D' ? ' checked' : '') + '>' + g + '</label>').join('');
  onBucketChange();
}

function collectSelection() {
  return {
    selection_id: 'C01',
    source_note: 'Electron 最小窗口点选；词表类字段值全部来自 data.js 派生数据集，不允许自造风格词',
    theme: {
      template_id: activeTemplate.id,
      template_status: activeTemplate.status,
      verified: activeTemplate.verified,
      fields: readS15(),
      card_id: cardResolution && cardResolution.card ? cardResolution.card.id : null,
      card_anchor: cardResolution && cardResolution.card ? cardResolution.card.anchor : null,
      card_override: !!(cardResolution && cardResolution.override),
      card_candidates: cardResolution ? cardResolution.candidates : 0
    },
    from_data: {
      bucket: $('bucket').value,
      topic: $('topic').value,
      mood_words: checkedValues('moodWords'),
      instruments: $('instruments').value,
      bpm: $('bpm').value,
      duration: $('duration').value
    },
    typed: {
      purpose_profile: $('purposeProfile').value,
      picture_function: $('pictureFunction').value,
      mood_arc_zh: $('moodArc').value,
      parameter_deviation: $('paramDeviation').value,
      excludes: [$('exclude1').value, $('exclude2').value].filter((x) => x.trim()),
      negative_groups: checkedValues('negativeGroups'),
      item_version: $('itemVersion').value
    }
  };
}

async function runOnce() {
  if (!contract || !contract.ok) {
    showResult('契约未通过，拒绝导出', 'fail');
    return { ok: false, error: '契约未通过' };
  }
  if (!cardResolution || !cardResolution.card) {
    showResult('S1.5 未命中取向卡，按模板未命中规则不生成。请调整四字段或切换模板。', 'fail');
    return { ok: false, error: 'S1.5 无取向卡' };
  }
  $('exportBtn').disabled = true;
  showResult('正在导出…', '');
  let result;
  try {
    result = await window.p85.runExport(collectSelection());
  } catch (e) {
    result = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  $('exportBtn').disabled = false;

  const lines = [result.ok ? '导出完成' : '导出失败'];
  if (result.summary) lines.push('静态自检：' + result.summary.PASS + ' PASS / ' + result.summary.FAIL + ' FAIL');
  if (result.product) lines.push('成品：' + result.product);
  if (result.selfcheck) lines.push('自检清单：' + result.selfcheck);
  if (result.exitCode !== undefined) lines.push('render.py 退出码：' + result.exitCode);
  if (result.error) lines.push('错误：' + result.error);
  if (result.stderr) lines.push('stderr：' + result.stderr);
  if (result.stdout) lines.push('--- render.py ---\n' + result.stdout);
  showResult(lines.join('\n'), result.ok ? 'ok' : 'fail');
  return result;
}

async function load() {
  try {
    const c = await window.p85.loadContract();
    contract = c;
    if (!c.ok) {
      setStatus('bad', '拒绝加载：' + (c.error || '未知'));
      $('exportBtn').disabled = true;
      showResult('真源校验失败：' + (c.error || '') + '\n' +
        JSON.stringify(c.sourceResults || [], null, 2), 'fail');
      return;
    }
    setStatus('good', '真源校验通过 · ' +
      c.sourceResults.filter((r) => r.ok).length + '/' + c.sourceResults.length);
    fillContract(c);
    initForm(c.data);
    showResult('契约加载完成：数据版本 ' + c.version + '，模型 ' +
      c.model.display + c.model.suffix + '。点「生成并导出」开始闭环。', '');
  } catch (e) {
    setStatus('bad', '加载异常');
    showResult(String(e && e.message ? e.message : e), 'fail');
  }
}

async function copyLocked(text) {
  const fb = $('copyFeedback');
  try {
    const r = await window.p85.copyText(text);
    fb.className = 'copy-feedback' + (r && r.ok ? '' : ' fail');
    fb.textContent = r && r.ok ? '已复制' : '复制失败';
  } catch (e) {
    fb.className = 'copy-feedback fail';
    fb.textContent = '复制失败';
  }
  setTimeout(() => { if (fb.textContent) fb.textContent = ''; }, 1600);
}

$('templateId').addEventListener('change', renderTemplate);
$('bucket').addEventListener('change', onBucketChange);
$('topic').addEventListener('change', onTopicChange);
$('exportBtn').addEventListener('click', () => { runOnce(); });
$('copyTagBtn').addEventListener('click', () => { copyLocked('[Instrumental]'); });
$('copyPlainBtn').addEventListener('click', () => { copyLocked('Instrumental'); });

const ready = load();
window.p85.onAutoExport(async () => {
  await ready;
  const r = await runOnce();
  window.p85.notifyDone(r);
});
