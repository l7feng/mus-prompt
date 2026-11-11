"""项目 85 · 运行期 + 导出期：点选配置 → 七层字段 → 1 条 -Suno.md → 静态自检。

B 阶段 CLI 原型与 C 阶段 Electron GUI 共用本脚本（GUI 通过 --selection/--out/--product/--selfcheck/--stage 传参），
不画界面、不写 GUI 代码、不生成音频；产物一律先落库外 exports/ 审阅区。
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import sys

BASE = pathlib.Path(__file__).resolve().parents[1]
DERIVED = BASE / "build"       # data.js 与 manifest.json 的构建期产物位
_LOCAL_CFG = BASE / "config/config.local.json"
_STATE_CFG = ""
if _LOCAL_CFG.is_file():
    try:
        _STATE_CFG = json.loads(_LOCAL_CFG.read_text(encoding="utf-8")).get("state_home") or ""
    except Exception:
        _STATE_CFG = ""
STATE = pathlib.Path(os.environ.get("P85_STATE_HOME") or _STATE_CFG or (BASE / "state"))
VAULT = pathlib.Path("D:/1-个人知识库_Vault")
BASELINE = DERIVED / "p85_baseline.json"   # 构建期产物；缺失说明没跑 build.py，该检查如实标「未执行」
TODAY = datetime.date.today().isoformat()
FRONTMATTER_KEYS = ["type", "title", "created", "updated", "status", "domain", "tags", "source"]

_parser = argparse.ArgumentParser(description="项目85 渲染与静态自检（B 阶段 CLI / C 阶段 GUI 共用）")
_parser.add_argument("--selection", default=None, help="点选配置 JSON；默认 BASE/selection.json")
_parser.add_argument("--out", default=None, help="产物目录；默认 BASE/exports")
_parser.add_argument("--product", default=None, help="产物文件名；默认 01-点选闭环-Suno.md")
_parser.add_argument("--selfcheck", default=None, help="自检清单路径；默认 BASE/selfcheck.json")
_parser.add_argument("--stage", default="B", help="阶段标记 B / C，只影响文案与 report.stage")
_parser.add_argument("--resolve-only", action="store_true", help="只解析 S1.5 取向卡并输出 JSON，不写成品")
_args = _parser.parse_args()

SEL_FILE = pathlib.Path(_args.selection) if _args.selection else STATE / "selection.json"
EXPORTS = pathlib.Path(_args.out) if _args.out else STATE / "exports"
PRODUCT_NAME = _args.product or "01-点选闭环-Suno.md"
SELFCHECK_FILE = pathlib.Path(_args.selfcheck) if _args.selfcheck else STATE / "selfcheck.json"
STAGE = str(_args.stage).upper()
STAGE_TITLE = "B阶段" if STAGE == "B" else "C阶段"
STAGE_DESC = "B 阶段只读原型闭环" if STAGE == "B" else "C 阶段 Electron 最小窗口"

checks = []


def check(name, cond, detail=""):
    checks.append({"item": name, "result": "PASS" if cond else "FAIL", "detail": str(detail)})
    return bool(cond)


def sha256(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def write_lf(path: pathlib.Path, text: str) -> None:
    if path.exists():
        path.unlink()
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def load_data():
    txt = (DERIVED / "data.js").read_text(encoding="utf-8")
    marker = "const P85_DATA = "
    if marker not in txt:
        raise ValueError("data.js 缺少 P85_DATA 赋值")
    data, _ = json.JSONDecoder().raw_decode(txt[txt.index(marker) + len(marker):])
    return data


def split_words(s):
    """词表单元格可能用 / 或 、 混排，统一拆成单词集合。"""
    return [w.strip() for w in re.split(r"[/、]", s) if w.strip()]


def norm_rule(v):
    v = str(v).strip()
    return "现实写实" if v == "写实" else v


def era_overlap(card_era, selected_era):
    """国外卡用年代区间（如 1940s–1950s），字段值可能是相邻区间或单值。"""
    if card_era == selected_era:
        return True
    a = [x.strip() for x in str(card_era).replace("–", "-").split("-") if x.strip()]
    b = [x.strip() for x in str(selected_era).replace("–", "-").split("-") if x.strip()]
    if len(a) == 1 and len(b) == 1:
        return False
    return any(x in b for x in a)


def resolve_card(tpl, fields):
    """与 renderer.js 的 resolveCard 同一口径；render.py 负责复核界面传来的 card_id。"""
    if not tpl:
        return None, False, 0
    if tpl["id"] == "nrta-cn-drama":
        era = fields.get("era", "")
        anchor = fields.get("anchor", "")
        short = anchor[len(era):] if anchor.startswith(era) else anchor
        key = era + "·" + short.replace("题材", "")
        rule = norm_rule(fields.get("rule", ""))
        timbre = fields.get("timbre", "")
        cand = [c for c in tpl["cards"]
                if key in c["match"]["theme_keys"] and rule in c["match"]["rule"]]
        exact = next((c for c in cand if timbre in c["match"]["timbre"]), None)
        if exact:
            return exact, False, len(cand)
        if timbre != "无特定":
            fallback = next((c for c in cand if "无特定" in c["match"]["timbre"]), None)
            if fallback:
                return fallback, True, len(cand)
        return None, False, len(cand)
    genres = [fields.get("genre_primary", ""), fields.get("genre_secondary", "")]
    genres = [g for g in genres if g]
    rule = norm_rule(fields.get("rule", ""))
    timbre = fields.get("timbre", "")
    cand = [c for c in tpl["cards"]
            if any(g in c["match"]["genre_keys"] for g in genres)
            and era_overlap(c["match"]["era"], fields.get("era", ""))
            and rule in c["match"]["rule"]
            and timbre in c["match"]["timbre"]]
    primary = [c for c in cand if fields.get("genre_primary") in c["match"]["genre_keys"]]
    pick = primary or cand
    return (pick[0] if pick else None), False, len(pick)


def fields_valid(tpl, fields):
    if not tpl:
        return False, "题材模板未找到"
    for f in tpl["fields"]:
        v = fields.get(f["key"], "")
        if f.get("allow_empty") and v == "":
            continue
        if f.get("depends_on"):
            parent = fields.get(f["depends_on"], "")
            allowed = (f.get("options_by") or {}).get(parent, [])
        else:
            allowed = f.get("options", [])
        if v not in allowed:
            return False, f["key"] + "=" + str(v)
    if tpl["id"] == "intl-imdb-production":
        if fields.get("genre_secondary") and fields.get("genre_secondary") == fields.get("genre_primary"):
            return False, "次类型不得与主类型相同"
    return True, ""


def field_pairs(tpl, fields):
    parts = []
    for f in tpl["fields"]:
        v = fields.get(f["key"], "")
        if not v and f.get("allow_empty"):
            v = "无"
        parts.append(f"{f['label']}={v}")
    return "｜".join(parts)


data = load_data()
manifest = json.loads((DERIVED / "manifest.json").read_text(encoding="utf-8"))
sel = json.loads(SEL_FILE.read_text(encoding="utf-8"))
lock = data["instrumental_lock"]["values"]
fd, tp = sel["from_data"], sel["typed"]

theme_registry = data["theme_templates"]["values"]
theme_sel = sel.get("theme")
if not theme_sel:
    default_tpl = next(t for t in theme_registry["templates"] if t["default"])
    theme_sel = {"template_id": default_tpl["id"], "fields": dict(default_tpl["default_s15"])}
theme_tpl = next((t for t in theme_registry["templates"]
                  if t["id"] == theme_sel.get("template_id")), None)
theme_fields = theme_sel.get("fields") or {}

print("DATA_VERSION", data["data_version"], "SOURCE_HASH_PREFIX", data["sources"][0]["sha256"][:16])
print("STAGE", STAGE, "SELECTION", SEL_FILE)
print("MODEL", data["model"]["display"], data["product_suffix"], data["model"]["status"])

# --- 运行期：构建期哈希与库内零改写 ---
hash_ok = all(
    sha256(VAULT / s["path"]) == s["sha256"] for s in manifest["sources"]
)
check(f"构建期源哈希可校验（manifest {len(manifest['sources'])} 份源逐一重算）", hash_ok,
      "sources=" + str(len(manifest["sources"])))

data_js_sha = sha256(DERIVED / "data.js")
check("data.js 与 manifest 自带哈希一致",
      any(o["name"] == "data.js" and o["sha256"] == data_js_sha for o in manifest["outputs"]),
      data_js_sha[:16])

if BASELINE.is_file():
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    _snap = baseline["template_sources"] + baseline["pointer_pages"]
    tpl_changed = [r["path"] for r in _snap
                   if not (VAULT / r["path"]).is_file() or sha256(VAULT / r["path"]) != r["sha256"]]
    check("库内 06-配乐生成模板 %d 份 md 零改写" % len(_snap), not tpl_changed, tpl_changed)
else:
    check("库内 06-配乐生成模板零改写", False,
          "未执行：基线缺失 " + str(BASELINE) + "（先跑 scripts/build.py；不静默放行）")

check("派生数据每个集合都带来源指针与源哈希",
      all("source" in data[k] and "source_sha256" in data[k] and "values" in data[k]
          for k in ("buckets", "russell_28", "cue_baseline", "suno_mood_15",
                    "seven_layer_fields", "samples", "route83", "theme_templates")))
check("样例标注 sample_only（不反推口径）", data["samples"]["sample_only"] is True)
# 2026-11-09 人类裁决「放宽校验」：非 Suno 模型只要未转「现役」就不进入界面可选项；
# 「探针实测中」与「骨架／禁生成」同属非现役状态，未知状态按 fail-closed 拒绝。
# 2026-11-10 人类听感裁决：SA3 解锁转「现役」、MUS-3「冻结」停止生成；
# 仅 SA3 按裁决放行「现役」行首，「冻结」收录为非现役状态，其余未知状态仍拒绝。
NON_CURRENT_STATES = ("骨架", "探针实测中", "未实测", "禁生成", "冻结")
RULED_CURRENT = {"stable-audio-3"}  # 2026-11-10 人类听感验收「SA3完全可以」解锁
check("非 Suno 模型状态与 2026-11-10 裁决一致且不在界面可选项",
      all((m["status"].startswith("现役") if m["id"] in RULED_CURRENT
           else (not m["status"].startswith("现役")
                 and any(k in m["status"] for k in NON_CURRENT_STATES)))
          for m in data["models"] if m["id"] != "suno"))

# --- 运行期：点选值闭环 ---
rows = data["cue_baseline"]["values"]
matched = [r for r in rows if
           r["bucket"] == fd["bucket"] and r["topic"] == fd["topic"] and
           r["instruments"] == fd["instruments"] and r["bpm"] == fd["bpm"] and
           r["duration"] == fd["duration"] and
           r["mood_words"] == " / ".join(fd["mood_words"])]
check("点选配置命中共享层 13 条基线中的一行", len(matched) == 1,
      fd["bucket"] + " / " + fd["topic"])

all_vocab = set()
for r in data["suno_mood_15"]["values"]:
    all_vocab.update(split_words(r["word"]))
for r in data["suno_mood_by_bucket"]["values"]:
    all_vocab.update(split_words(r["primary"]))
check("情绪词全部落在 Suno 模型卡词表内（词表闭环）",
      all(w in all_vocab for w in fd["mood_words"]), fd["mood_words"])

bucket_row = next((r for r in data["suno_mood_by_bucket"]["values"]
                   if r["bucket"] == fd["bucket"]), None)
primary = set(split_words(bucket_row["primary"])) if bucket_row else set()
check("一词一桶：所选情绪词主归桶与点选桶一致（无跨桶改判）",
      all(w in primary for w in fd["mood_words"]),
      "primary=" + str(sorted(primary)))
check("九桶定义可解析且桶位命中",
      any(b["id"] == fd["bucket"] for b in data["buckets"]["values"]))
check("七层字段位来自库内参考成品，不是渲染器硬编码",
      data["seven_layer_fields"]["values"] ==
      ["用途剖面", "画面功能", "情绪层", "声音层", "参数层", "参数偏离", "排除项"])

# --- 运行期：S1.5 题材层与取向卡（无卡不生成） ---
fields_ok, fields_detail = fields_valid(theme_tpl, theme_fields)
card, card_override, card_candidates = resolve_card(theme_tpl, theme_fields)
check("S1.5 题材模板与四字段均落在模板受控词表内",
      theme_tpl is not None and fields_ok,
      (theme_tpl["id"] if theme_tpl else "模板未找到") + " / " + fields_detail)
check("S1.5 取向卡命中（无卡不生成）", card is not None,
      (card["anchor"] if card else "无卡：" + str(theme_fields)))
if card is not None:
    check("S1.5 取向卡与界面选择一致",
          card["id"] == theme_sel.get("card_id"),
          f"{card['id']} / {theme_sel.get('card_id')}")
    check("S1.5 音色域覆盖标记与渲染一致",
          bool(theme_sel.get("card_override")) == bool(card_override),
          f"override={card_override}")

if _args.resolve_only:
    resolution = {
        "ok": bool(card is not None and fields_ok and theme_tpl is not None),
        "template": ({"id": theme_tpl["id"], "status": theme_tpl["status"],
                      "verified": theme_tpl.get("verified", False)}
                     if theme_tpl else None),
        "fields": theme_fields,
        "fields_ok": bool(fields_ok),
        "fields_detail": fields_detail,
        "card": card,
        "override": bool(card_override),
        "candidates": card_candidates,
        "failed_checks": [c for c in checks if c["result"] == "FAIL"],
    }
    print("RESOLVE_JSON " + json.dumps(resolution, ensure_ascii=False))
    sys.exit(0 if resolution["ok"] else 1)

if card is None or theme_tpl is None:
    SELFCHECK_FILE.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "schema": "p85-selfcheck-v1",
        "stage": STAGE_DESC,
        "generated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "data_version": data["data_version"],
        "product": None,
        "selection": sel,
        "checks": checks,
        "summary": {
            "PASS": sum(1 for c in checks if c["result"] == "PASS"),
            "FAIL": sum(1 for c in checks if c["result"] == "FAIL"),
        },
        "blocked": "S1.5 无取向卡或题材模板无效，按模板未命中规则不生成",
        "gate_note": "S1.5 阻断发生在成品落盘前；未生成 -Suno.md。",
        "not_tested": ["成品未生成", "真窗口/GUI", "跨机", "Obsidian 渲染",
                       "Suno 实际生成/试听/回片", "suno-prompt-tool 措辞组织"],
    }
    write_lf(SELFCHECK_FILE, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("PRODUCT", None)
    print("SELFCHECK", SELFCHECK_FILE)
    print("SELFCHECK PASS/FAIL", report["summary"]["PASS"], "/", report["summary"]["FAIL"])
    for c in checks:
        if c["result"] == "FAIL":
            print("  FAIL", c["item"], c["detail"])
    sys.exit(1)

# --- 导出期：渲染 ---
arc_en = lock["arc_language"].replace("→", "->")
arc_zh = lock["arc_language"]
mood = " / ".join(fd["mood_words"])
styles = (
    f"{mood} instrumental BGM. {fd['bpm']} BPM, {fd['duration']} arc: {arc_en}. "
    "Pure instrumental texture, no lead vocal melody. "
    + lock["mandatory_negative_full"] + " "
    + "Locked: " + lock["mandatory_negative"] + ", instrumental only."
)
zh = (f"{fd['bucket']}纯器乐配乐，情绪词 {mood}，{fd['bpm']} BPM，"
      f"建议时长 {fd['duration']}，弧度 {arc_zh}。纯器乐织体、无演唱主旋律，"
      "无人声、无演唱、无说唱、无哼唱。")

theme_line = (f"- 题材层（S1.5）：`{theme_tpl['id']}`（{theme_tpl['status']}）"
              f"｜{field_pairs(theme_tpl, theme_fields)}")
card_line = (f"- 取向卡：{card['anchor']}｜音阶调式：{card['scale']}"
             f"｜主奏乐器：{card['instruments']}｜织体空间：{card['texture']}")
if card_override:
    card_line += "｜音色域覆盖：卡默认「无特定」主奏降级为参考，按项目 S0 乐器口径执行"
sound_layer = f"{fd['instruments']}（取自共享层 13 条基线六列；S1.5 取向卡见上）"
exclude_line = "；".join(tp["excludes"]) + "｜取向卡：" + card["excludes"]

source_rows = "\n".join(
    "| " + s["role"] + " | " + s["note"] + " | `" + s["path"] + "` |"
    for s in data["sources"]
)

doc = f"""---
type: 条目
title: 项目85 {STAGE_TITLE}点选闭环验证条目 · {fd['bucket']} {fd['topic']}
created: {TODAY}
updated: {TODAY}
status: 待审核
domain: 音频
tags: [音频, 配乐, 提示词, Suno, 项目85, 题材层, {STAGE_TITLE}]
source: {TODAY} 项目85 {STAGE_DESC}；数据由 build.py 从库内 md 派生，见「来源」
model: Suno
---

# 项目 85 {STAGE_TITLE}点选闭环验证条目 · {fd['bucket']} {fd['topic']}

## 本页范围

- 性质：{STAGE_DESC}的**结构验证版**产物，不是可交付音频提示词。英文 Styles 块只由词表值与契约常量拼装，**未调用 `suno-prompt-tool` 做措辞组织**，不可直接用于真实生成。
- 数据版本：`{data['data_version']}`；派生数据 `data.js` 源哈希前缀 `{data_js_sha[:16]}`；校验清单 `manifest.json`／`selfcheck.json`（均在库外运行态目录）。
- 模型：`suno`／`Suno`／`-Suno`／现役；StableAudio3 现役（2026-11-10 人类听感验收解锁）、MiniMax-Music3 冻结（2026-11-10 停止生成），两者均不在本应用可选项，本条不使用其词表。
- 题材层：`{theme_tpl['id']}`／{theme_tpl['status']}；四字段与取向卡只提供声音语义，不写模型专有语法，情绪九桶与模型卡零改写。取向卡主奏与共享层基线不一致时，以项目 S0 乐器口径为准并登记偏差。
- 本轮不生成音频、不试听、不回片；文本自检不等于音频验收。
- 未实测边界：跨机、Obsidian 渲染、其他 Agent 触发、Suno 实际生成与听审；真窗口验证情况见项目 `Documentation.md`。`--gate phase` 只扫描项目目录内内容文件，本页在库外审阅区，三方一致由 `selfcheck.json` 覆盖。

## 条目

### {sel['selection_id']} / {fd['bucket']} {fd['topic']}

{theme_line}
{card_line}
- 用途剖面：{tp['purpose_profile']}
- 画面功能：{tp['picture_function']}
- 情绪层：{fd['bucket']}｜技能情绪词：{mood}｜走向：{tp['mood_arc_zh']}｜改判依据：无（两词均主归 {fd['bucket'][:2]} 桶）
- 声音层：{sound_layer}
- 参数层：BPM {fd['bpm']}｜建议时长 {fd['duration']}｜弧度 {arc_en}
- 参数偏离：{tp['parameter_deviation']}
- 排除项：{exclude_line}
- 来源：七层字段位与词表指针见本页「来源」；派生数据 `{data['data_version']}`。

Styles（英文整段，结构验证版）：

```
{styles}
```

---

中文翻译：{zh}

- 歌词框：`{lock['lyrics_box']}`（只读，不写进 Styles）
- 负向词组：{'＋'.join(tp['negative_groups'])}（{len(tp['negative_groups'])} 组，单条不超过 3 组）
- 文本自检项：编号唯一｜七层字段齐全｜英文块可整段复制且无中文｜含 no vocals｜负向词 ≤3 组｜情绪词可归桶｜参数偏离行存在｜中英成对｜歌词框 [Instrumental]｜无歌曲结构标签｜model／后缀／路由表三方一致
- 条目版本：{tp['item_version']}

## 来源

| 代号 | 内容 | 路径 |
| --- | --- | --- |
{source_rows}

- 约束依据：[项目85 方案详版](4-项目-P/85-配乐提示词生成器方案/01-方案详版-界面映射与D1-D4.md) 三条硬线；纯器乐双保险见 [Suno 模型卡](6-资产-R/00-模板/06-配乐生成模板/模型卡/Suno.md)；S1.5 题材层与取向卡见 `{theme_tpl['source']}`。
"""

EXPORTS.mkdir(parents=True, exist_ok=True)
product = EXPORTS / PRODUCT_NAME
write_lf(product, doc)
text = product.read_text(encoding="utf-8")

# --- 导出期：静态自检 ---
fm = text.split("---", 2)[1]
check("frontmatter 八字段齐全", all(re.search(r"^" + k + r":", fm, re.M) for k in FRONTMATTER_KEYS))
check("frontmatter 含 model: Suno", bool(re.search(r"^model:[ \t]*Suno\s*$", fm, re.M)))
check("单一级标题", len(re.findall(r"^#\s+.+$", text, re.M)) == 1)
check("文件行尾为 LF", b"\r\n" not in product.read_bytes())

layer_names = data["seven_layer_fields"]["values"]
check("七层字段齐全", all(re.search(r"^- " + re.escape(n) + r"：", text, re.M) for n in layer_names),
      layer_names)
check("英文 Styles 块无中文字符", not re.search(r"[\u4e00-\u9fff]", styles))
check("英文 Styles 块含 no vocals", lock["mandatory_negative"] in styles)
check("歌词框 [Instrumental] 只读且出现", lock["lyrics_box"] in text)
check("无歌曲结构标签", not any(s in text for s in lock["forbidden_structures"]),
      lock["forbidden_structures"])
check("不提供人声开关", lock["vocal_switch"] == "disabled" and "人声开关" not in text)
check("负向词组 ≤3 组", len(tp["negative_groups"]) <= 3, len(tp["negative_groups"]))
check("参数偏离行存在", "参数偏离：" in text)
check("中英成对（Styles 块与中文翻译均存在）", "Styles（英文整段" in text and "中文翻译：" in text)
check("纯器乐文本含无人声口径", "无人声" in text and "纯器乐" in text)
check("S1.5 题材模板验收状态写入成品", theme_tpl["status"] in text, theme_tpl["status"])
check("S1.5 取向卡锚点写入成品", card["anchor"] in text, card["anchor"])
check("S1.5 音色域覆盖如实标注", (not card_override) or "音色域覆盖" in text,
      f"override={card_override}")

suffix_name = re.search(r"-(\w+)\.md$", PRODUCT_NAME).group(1)
model_value = re.search(r"^model:[ \t]*(\S+)", fm, re.M).group(1)
suffix_readme = data["product_suffix"].lstrip("-")
suffix_83 = next(r["suffix"].lstrip("-") for r in data["route83"]["values"] if r["id"] == "suno")
check("model／文件名后缀／README 路由表／项目83 路由表四方一致",
      model_value == suffix_name == suffix_readme == suffix_83,
      f"{model_value} / {suffix_name} / {suffix_readme} / {suffix_83}")

product_rel = product.relative_to(BASE).as_posix() if product.is_relative_to(BASE) else str(product)
report = {
    "schema": "p85-selfcheck-v1",
    "stage": STAGE_DESC,
    "generated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
    "data_version": data["data_version"],
    "product": product_rel,
    "product_sha256": sha256(product),
    "selection": sel,
    "s1_5": {
        "template_id": theme_tpl["id"],
        "template_status": theme_tpl["status"],
        "fields": theme_fields,
        "card_id": card["id"],
        "card_anchor": card["anchor"],
        "card_override": card_override,
        "card_candidates": card_candidates,
    },
    "checks": checks,
    "summary": {
        "PASS": sum(1 for c in checks if c["result"] == "PASS"),
        "FAIL": sum(1 for c in checks if c["result"] == "FAIL"),
    },
    "gate_note": "check_project_contract.py --gate phase 只扫描项目目录内内容文件；库外审阅区成品的三方一致由本自检覆盖，闸门另跑并如实登记覆盖范围。",
    "not_tested": (["真窗口/GUI", "跨机", "Obsidian 渲染", "其他 Agent 触发",
                    "Suno 实际生成/试听/回片", "suno-prompt-tool 措辞组织",
                    "S1.5 取向卡听感映射"] if STAGE == "B" else
                   ["操作系统屏幕级截图", "跨机", "Obsidian 渲染", "其他 Agent 触发",
                    "Suno 实际生成/试听/回片", "suno-prompt-tool 措辞组织",
                    "S1.5 取向卡听感映射", "C 后续轮次的完整 15 栏目界面"]),
}
write_lf(SELFCHECK_FILE, json.dumps(report, ensure_ascii=False, indent=2) + "\n")

print("PRODUCT", product)
print("SELFCHECK", SELFCHECK_FILE)
print("SELFCHECK PASS/FAIL", report["summary"]["PASS"], "/", report["summary"]["FAIL"])
for c in checks:
    if c["result"] == "FAIL":
        print("  FAIL", c["item"], c["detail"])
sys.exit(1 if report["summary"]["FAIL"] else 0)
