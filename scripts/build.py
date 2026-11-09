"""项目 85 · B 阶段构建期：只读解析库内 md 真源，派生 data.js + manifest.json。

真源（库内，一律只读）：
  6-资产-R/00-模板/06-配乐生成模板/README.md
  6-资产-R/00-模板/06-配乐生成模板/共享层/01..04
  6-资产-R/00-模板/06-配乐生成模板/模型卡/Suno.md
  6-资产-R/00-模板/06-配乐生成模板/样例/Suno-13条示例.md
  4-项目-P/83-影视配乐提示词整理-Suno/01-模型适配路由表.md
  4-项目-P/83-影视配乐提示词整理-Suno/03-九桶提示词-日常温情-Suno.md（仅解析字段位名称）

约束：库内零改写；派生数据只含「指针 + 值 + 来源路径」，不复制规则正文；
      不内嵌第二份词表；样例标注 sample_only，不反推口径；骨架模型保持禁生成。
"""
from __future__ import annotations

import datetime
import hashlib
import json
import pathlib
import re

VAULT = pathlib.Path("D:/1-个人知识库_Vault")
TPL = VAULT / "6-资产-R/00-模板/06-配乐生成模板"
P83 = VAULT / "4-项目-P/83-影视配乐提示词整理-Suno"
BASE = pathlib.Path(__file__).resolve().parents[1]
OUT = BASE / "build"          # 派生数据：机器生成、删了可重建，已在 .gitignore
OUT.mkdir(parents=True, exist_ok=True)
TODAY = datetime.date.today().isoformat()
DATA_VERSION = TODAY + "-01"

SOURCES = [
    ("contract", TPL / "README.md", "唯一契约与模型路由入口"),
    ("shared_emotion", TPL / "共享层/01-情绪框架.md", "九桶、Russell 28 词母表、校验规则接口"),
    ("shared_cue", TPL / "共享层/02-Cue编排骨架.md", "全局设定、13 条基线六列、每集套用"),
    ("shared_naming", TPL / "共享层/03-命名与归档规范.md", "命名格式槽位"),
    ("shared_workflow", TPL / "共享层/04-生成工作流.md", "S0–S5 与 G1–G4"),
    ("model_card_suno", TPL / "模型卡/Suno.md", "Suno 专有情绪词表、纯器乐双保险、弧度语言"),
    ("samples_suno", TPL / "样例/Suno-13条示例.md", "已填结果，仅作展示，不反推口径"),
    ("route83", P83 / "01-模型适配路由表.md", "项目级产物后缀与状态"),
    ("reference_item", P83 / "03-九桶提示词-日常温情-Suno.md", "仅解析七层字段位名称，不复制提示词正文"),
]

FORBIDDEN_STRUCTURES = ["[Verse]", "[Chorus]", "[Bridge]"]


def sha256(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rel(p: pathlib.Path) -> str:
    return p.relative_to(VAULT).as_posix()


def clean(v: str) -> str:
    v = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", v.strip())
    return v.replace("`", "").replace("**", "").strip()


def parse_tables(text: str):
    out, cur = [], []
    for raw in text.splitlines():
        s = raw.strip()
        if s.startswith("|") and s.endswith("|") and len(s) >= 3:
            cells = [c.strip() for c in s[1:-1].split("|")]
            if cells and all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                continue
            cur.append(cells)
        else:
            if len(cur) >= 2:
                out.append(cur)
            cur = []
    if len(cur) >= 2:
        out.append(cur)
    return out


def pick(tables, *keys):
    for t in tables:
        head = " ".join(t[0])
        if all(k in head for k in keys):
            return t
    raise KeyError("未找到表头：" + "/".join(keys))


def section(text: str, title: str) -> str:
    m = re.search(r"^##\s+" + re.escape(title) + r"\s*$([\s\S]*?)(?=^##\s|\Z)", text, re.M)
    return m.group(1) if m else ""


def write_lf(path: pathlib.Path, text: str) -> None:
    if path.exists():
        path.unlink()
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(text)


src = {}
for role, p, note in SOURCES:
    if not p.is_file():
        raise FileNotFoundError(str(p))
    src[role] = {
        "path": rel(p), "note": note, "sha256": sha256(p),
        "bytes": p.stat().st_size, "text": p.read_text(encoding="utf-8"),
    }


def ds(role, values, extra=None):
    d = {
        "source": src[role]["path"],
        "source_sha256": src[role]["sha256"],
        "values": values,
    }
    if extra:
        d.update(extra)
    return d


# 1. 模型路由（模板区 README）
rt = pick(parse_tables(src["contract"]["text"]), "模型 ID", "产物后缀")
models = [{
    "id": clean(r[0]), "display": clean(r[1]), "card": clean(r[2]),
    "suffix": clean(r[3]), "status": clean(r[4]),
} for r in rt[1:] if len(r) >= 5]
suno = next(m for m in models if m["id"] == "suno")

# 2. 共享层：九桶 / Russell 28 词 / 校验规则接口（只取编号与名称）
et = parse_tables(src["shared_emotion"]["text"])
buckets = [{
    "id": clean(r[0]), "quadrant": clean(r[1]), "axis": clean(r[2]),
    "target": clean(r[3]), "dramatic": clean(r[4]),
} for r in pick(et, "桶位", "象限", "目标情绪状态")[1:] if len(r) >= 5]

r28 = []
for r in pick(et, "序", "词", "象限")[1:]:
    if len(r) >= 6:
        r28.append({"n": int(clean(r[0])), "word": clean(r[1]), "quadrant": clean(r[2])})
        r28.append({"n": int(clean(r[3])), "word": clean(r[4]), "quadrant": clean(r[5])})
r28.sort(key=lambda x: x["n"])

rules = [{"n": int(m.group(1)), "name": m.group(2).strip()}
         for m in re.finditer(r"^\s*(\d+)\.\s+\*\*(.+?)\*\*",
                              section(src["shared_emotion"]["text"], "校验规则"), re.M)]

# 3. 共享层：13 条基线 / 全局设定 / 每集套用 / 命名格式槽位 / 流程与闸门
ct = parse_tables(src["shared_cue"]["text"])
cue_baseline = [{
    "bucket": clean(r[0]), "topic": clean(r[1]), "mood_words": clean(r[2]),
    "bpm": clean(r[3]), "duration": clean(r[4]), "instruments": clean(r[5]),
    "use": clean(r[6]),
} for r in pick(ct, "桶位", "主题信息", "BPM")[1:] if len(r) >= 7]

global_settings = [{"field": clean(r[0]), "value": clean(r[1])}
                   for r in pick(ct, "项目", "设定")[1:] if len(r) >= 2]

episode_map = [{"segment": clean(r[0]), "span": clean(r[1]),
                "cue": clean(r[2]), "edit": clean(r[3])}
               for r in pick(ct, "单集段落", "配乐")[1:] if len(r) >= 4]

nt = parse_tables(src["shared_naming"]["text"])
naming_fields = [clean(r[0]) for r in pick(nt, "字段", "规则")[1:] if r]

wt = src["shared_workflow"]["text"]
stages = [{"code": m.group(1), "name": m.group(2).strip()}
          for m in re.finditer(r"^###\s+(S\d)\s+(.+)$", wt, re.M)]
gates = [{"code": clean(r[0]), "position": clean(r[1])}
         for r in pick(parse_tables(wt), "闸门", "位置")[1:] if len(r) >= 2]

# 4. Suno 模型卡：情绪词表 + 纯器乐锁死常量
mt = parse_tables(src["model_card_suno"]["text"])
mood_by_bucket = [{
    "bucket": clean(r[0]), "russell": clean(r[1]),
    "primary": clean(r[2]), "caution": clean(r[3]) if len(r) > 3 else "",
} for r in pick(mt, "桶位", "Russell 28 词对应")[1:] if len(r) >= 3]
mood15 = [{
    "word": clean(r[0]), "quadrant": clean(r[1]), "bucket": clean(r[2]),
    "note": clean(r[3]) if len(r) > 3 else "",
} for r in pick(mt, "Suno 情绪词", "象限定位")[1:] if len(r) >= 3]

card = src["model_card_suno"]["text"]
lyrics_tag = "[Instrumental]" if "[Instrumental]" in card else None
no_vocals = "no vocals" if "no vocals" in card else None
arc_m = re.search(r"intro\s*→\s*build\s*→\s*peak\s*→\s*ending", card)
if not (lyrics_tag and no_vocals and arc_m):
    raise ValueError("Suno 模型卡纯器乐双保险或弧度语言未检出，拒绝构建")
instrumental_lock = {
    "lyrics_box": lyrics_tag,
    "mandatory_negative": no_vocals,
    "mandatory_negative_full": "No vocals, no singing, no rap, no humming.",
    "arc_language": arc_m.group(0),
    "forbidden_structures": FORBIDDEN_STRUCTURES,
    "forbidden_source": "4-项目-P/85-配乐提示词生成器方案/01-方案详版-界面映射与D1-D4.md（硬线三）",
    "vocal_switch": "disabled",
}

# 5. 样例：已填结果，只作展示
samples = []
for chunk in re.split(r"^###\s+", src["samples_suno"]["text"], flags=re.M)[1:]:
    title = chunk.splitlines()[0].strip()
    fn = re.search(r"文件名：`([^`]+)`", chunk)
    en = re.search(r"```\s*\n(.*?)\n```", chunk, re.S)
    zh = re.search(r"^中文翻译：(.+)$", chunk, re.M)
    if en and fn:
        samples.append({"title": title, "filename": fn.group(1),
                        "styles_en": en.group(1).strip(),
                        "zh": zh.group(1).strip() if zh else ""})

# 6. 项目 83 路由表 + 参考成品的字段位名称
r83 = [{
    "id": clean(r[0]), "card": clean(r[1]), "suffix": clean(r[2]), "status": clean(r[3]),
} for r in pick(parse_tables(src["route83"]["text"]), "模型 ID", "产物后缀")[1:] if len(r) >= 4]

ref = src["reference_item"]["text"]
field_names = []
for m in re.finditer(r"^-\s+([^：\n]+)：", ref, re.M):
    name = m.group(1).strip()
    if name not in field_names:
        field_names.append(name)
SEVEN_LAYER_NAMES = ["用途剖面", "画面功能", "情绪层", "声音层", "参数层", "参数偏离", "排除项"]
seven_layer = [n for n in field_names if n in SEVEN_LAYER_NAMES]
if len(seven_layer) != 7:
    raise ValueError("参考成品未解析出完整七层字段位：" + str(seven_layer))

data = {
    "schema": "p85-derived-data-v1",
    "data_version": DATA_VERSION,
    "generated_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
    "truth_policy": {
        "library_md_is_only_truth": True,
        "json_contains": ["pointer", "value", "source_path"],
        "rule_prose_copied": False,
        "samples_are_not_authority": True,
        "d3": "甲·构建期记哈希（不启用启动期实时重算）",
    },
    "model": {"id": suno["id"], "display": suno["display"],
              "card": src["model_card_suno"]["path"], "status": suno["status"]},
    "product_suffix": suno["suffix"],
    "models": models,
    "sources": [{"role": role, "path": src[role]["path"],
                 "sha256": src[role]["sha256"], "bytes": src[role]["bytes"],
                 "note": src[role]["note"]} for role, _, _ in SOURCES],
    "buckets": ds("shared_emotion", buckets),
    "russell_28": ds("shared_emotion", r28),
    "validation_rules": ds("shared_emotion", rules),
    "cue_baseline": ds("shared_cue", cue_baseline),
    "global_settings": ds("shared_cue", global_settings),
    "episode_map": ds("shared_cue", episode_map),
    "naming_fields": ds("shared_naming", naming_fields),
    "workflow_stages": ds("shared_workflow", stages),
    "quality_gates": ds("shared_workflow", gates),
    "suno_mood_by_bucket": ds("model_card_suno", mood_by_bucket),
    "suno_mood_15": ds("model_card_suno", mood15),
    "instrumental_lock": ds("model_card_suno", instrumental_lock),
    "samples": ds("samples_suno", samples, {"sample_only": True}),
    "item_fields": ds("reference_item", field_names),
    "seven_layer_fields": ds("reference_item", seven_layer),
    "route83": ds("route83", r83),
}

js_text = (
    "/* 项目 85 B 阶段派生数据 · 由 build.py 从库内 md 只读派生 · 禁止手改 */\n"
    "/* data_version: " + DATA_VERSION + " · 真源见 manifest.json */\n"
    "const P85_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
)
write_lf(OUT / "data.js", js_text)

manifest = {
    "schema": "p85-build-manifest-v1",
    "data_version": DATA_VERSION,
    "generated_at": data["generated_at"],
    "project": "4-项目-P/85-配乐提示词生成器方案",
    "stage": "B 只读原型闭环",
    "model": {"id": suno["id"], "display": suno["display"],
              "model_card": src["model_card_suno"]["path"],
              "status": suno["status"], "product_suffix": suno["suffix"]},
    "skeleton_models": [m for m in models if "骨架" in m["status"]],
    "sources": data["sources"],
    "outputs": [],
    "policy": {
        "library_truth_zero_write": True,
        "data_js_has_no_embedded_vocab": True,
        "json_pointer_value_source_only": True,
        "vocals_locked_to_instrumental": True,
        "export_lands_outside_vault_first": True,
        "d1": "丙·桌面应用（C 阶段载体；B 阶段为不画界面的 CLI 原型）",
        "d2": "甲·先跑一条",
        "d3": "甲·构建期记哈希",
        "d4": "甲·落盘并过闸门",
    },
    "verify": {"source_count": len(SOURCES), "library_writes": 0,
               "baseline_file": "build/p85_baseline.json"},
}
for name in ("data.js",):
    p = OUT / name
    manifest["outputs"].append({"name": name, "sha256": sha256(p), "bytes": p.stat().st_size})
write_lf(OUT / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

# 库内 06-配乐生成模板 的 md 快照：构建期落一份哈希基线，
# 供 render.py 在导出时检测「构建之后库内是否被改写」。基线属可再生成产物，随构建重建。
tpl_files = sorted(p for p in TPL.rglob("*.md") if p.is_file())
baseline = {
    "schema": "p85-baseline-v1",
    "generated_at": data["generated_at"],
    "note": ("构建期生成；render.py 用它在导出时核对 06 模板是否在构建后被改写。"
             "原基线文件 D:/My-Temporary/p85/p85_baseline.json 已丢失，"
             "2026-11-08 迁仓时改为构建期产物，不再依赖仓外手工文件。"),
    "template_sources": [{"path": p.relative_to(VAULT).as_posix(), "sha256": sha256(p)}
                         for p in tpl_files],
    "pointer_pages": [],
}
write_lf(OUT / "p85_baseline.json", json.dumps(baseline, ensure_ascii=False, indent=2) + "\n")

print("BUILD_OK", DATA_VERSION)
print("SOURCES", len(SOURCES), "BYTES", sum(x["bytes"] for x in data["sources"]))
print("MODEL", suno["id"], suno["display"], suno["suffix"], suno["status"])
print("SKELETON", [m["display"] for m in manifest["skeleton_models"]])
print("BUCKETS", len(buckets), "RUSSELL28", len(r28), "RULES", len(rules),
      "CUE13", len(cue_baseline), "MOOD15", len(mood15), "SAMPLES", len(samples))
print("ITEM_FIELDS", len(field_names), "SEVEN_LAYER", len(seven_layer), seven_layer)
print("ROUTE83_SUFFIX", [r["suffix"] for r in r83])
print("LOCK", instrumental_lock["lyrics_box"], "|", instrumental_lock["mandatory_negative"])
print("DATA_JS_SHA", sha256(OUT / "data.js")[:16])
print("MANIFEST_SHA", sha256(OUT / "manifest.json")[:16])
