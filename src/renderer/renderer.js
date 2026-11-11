'use strict';

// 渲染进程：只读 data.js 派生的词表，收集点选配置，交给主进程调用 render.py。
// 不内嵌任何词表；不允许自由输入自造风格词。

let contract = null;

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
