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
    box.innerHTML = '<h3>没有匹配的取向卡</h3>' +
      '<p class="bad-text">请调整题材分类，或换一个题材模板。' +
      (activeTemplate.verified ? '' : ' 该模板的卡尚未验收，仅供参考。') + '</p>';
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
      ? '<p class="warn-text">所选音色不在该卡范围内，已按题材默认音色处理。</p>'
      : '') +
    (!activeTemplate.verified
      ? '<p class="warn-text">该模板的卡尚未验收，仅供参考。</p>'
      : '');
  $('exportBtn').disabled = false;
}

function renderTemplate() {
  const reg = themeRegistry();
  activeTemplate = reg.templates.find((t) => t.id === $('templateId').value) || reg.templates[0];
  const badges = [];
  if (activeTemplate.default) badges.push('<span class="badge good">默认</span>');
  badges.push('<span class="badge ' + (activeTemplate.verified ? 'good' : 'warn') + '">' +
    (activeTemplate.verified ? '已验证' : '待验证') + '</span>');
  badges.push('<span class="badge">' + activeTemplate.cards.length + ' 张取向卡</span>');
  $('templateBadge').innerHTML = badges.join('');
  const c = activeTemplate.coverage;
  $('coverageLine').textContent = c.with_card + ' / ' + c.total + ' 个题材有取向卡';
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
    source_note: '界面点选；词表来自配乐模板',
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
    showResult('模板数据异常，无法导出。', 'fail');
    return { ok: false, error: '模板数据异常' };
  }
  if (!cardResolution || !cardResolution.card) {
    showResult('没有匹配的取向卡，无法生成。请调整题材分类或换模板。', 'fail');
    return { ok: false, error: '没有匹配的取向卡' };
  }
  $('exportBtn').disabled = true;
  showResult('正在生成…', '');
  let result;
  try {
    result = await window.p85.runExport(collectSelection());
  } catch (e) {
    result = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  $('exportBtn').disabled = false;

  const lines = [result.ok ? '生成完成' : '生成失败'];
  if (result.summary) {
    lines.push(result.ok
      ? '检查通过 ' + result.summary.PASS + ' 项'
      : '有 ' + result.summary.FAIL + ' 项检查未通过');
  }
  if (result.product) lines.push('文件：' + result.product.split(/[\\/]/).pop());
  if (!result.ok && result.error) lines.push(result.error);
  showResult(lines.join('\n'), result.ok ? 'ok' : 'fail');
  return result;
}

async function load() {
  try {
    const c = await window.p85.loadContract();
    contract = c;
    if (!c.ok) {
      setStatus('bad', '加载失败');
      $('exportBtn').disabled = true;
      showResult('模板数据校验失败，请重新生成词表后再试。', 'fail');
      return;
    }
    setStatus('good', '已载入');
    initForm(c.data);
    showResult('点「生成并导出」开始。', '');
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
