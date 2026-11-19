"""项目 85 · B 阶段构建期：只读解析库内 md 真源，派生 data.js + manifest.json。

真源（库内，一律只读）：
  6-资产-R/00-模板/06-配乐生成模板/README.md
  6-资产-R/00-模板/06-配乐生成模板/共享层/01..04
  6-资产-R/00-模板/06-配乐生成模板/模型卡/Suno.md
  6-资产-R/00-模板/06-配乐生成模板/样例/示例.md
  6-资产-R/00-模板/06-配乐生成模板/题材分类模板/中国影视配乐题材分类模板（广电）.md
  6-资产-R/00-模板/06-配乐生成模板/题材分类模板/国外影视题材分类模板.md
  5-领域-A/06-软件制作/85-配乐提示词生成器方案/01-方案详版-界面映射与D1-D4.md（仅解析七层字段位名称）

  2026-11-12 适配：项目 95 已将共享层重构为「28 词基线」（八桶、词级基线、单集词映射），
  本脚本按新表结构解析；项目 83 已删入回收站，路由表源移除（模型路由以 README 路由表为准），
  七层字段位名称改从项目 85 方案详版解析。

约束：库内零改写；派生数据只含「指针 + 值 + 来源路径」，不复制规则正文；
      不内嵌第二份词表；样例标注 sample_only，不反推口径；非现役模型保持禁生成。
"""
from __future__ import annotations

import datetime
import hashlib
import json
import pathlib
import re

VAULT = pathlib.Path("D:/1-个人知识库_Vault")
TPL = VAULT / "6-资产-R/00-模板/06-配乐生成模板"
P85 = VAULT / "5-领域-A/06-软件制作/85-配乐提示词生成器方案"
BASE = pathlib.Path(__file__).resolve().parents[1]
OUT = BASE / "build"          # 派生数据：机器生成、删了可重建，已在 .gitignore
OUT.mkdir(parents=True, exist_ok=True)
TODAY = datetime.date.today().isoformat()
DATA_VERSION = TODAY + "-02"

SOURCES = [
    ("contract", TPL / "README.md", "唯一契约与模型路由入口"),
    ("shared_emotion", TPL / "共享层/01-情绪框架.md", "九桶、Russell 28 词母表、校验规则接口"),
    ("shared_cue", TPL / "共享层/02-Cue编排骨架.md", "全局设定、13 条基线六列、每集套用"),
    ("shared_naming", TPL / "共享层/03-命名与归档规范.md", "命名格式槽位"),
    ("shared_workflow", TPL / "共享层/04-生成工作流.md", "S0–S5 与 G1–G4"),
    ("model_card_suno", TPL / "模型卡/Suno.md", "Suno 专有情绪词表、纯器乐双保险、弧度语言"),
    ("samples_suno", TPL / "样例/示例.md", "已填结果，仅作展示，不反推口径"),
    ("theme_cn", TPL / "题材分类模板/中国影视配乐题材分类模板（广电）.md",
     "S1.5 四字段、广电受控词表、10 张取向卡（已实测验收）"),
    ("theme_intl", TPL / "题材分类模板/国外影视题材分类模板.md",
     "S1.5 四字段、IMDb 28 类、10 张取向卡（待实测验收）"),
    ("reference_item", P85 / "01-方案详版-界面映射与D1-D4.md", "仅解析七层字段位名称，不复制提示词正文"),
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


def split_multi(v: str):
    """单元格里的受控值用全角/半角斜杠或顿号分隔。"""
    return [x.strip() for x in re.split(r"[／/、]", clean(v)) if x.strip()]


def split_tokens(v: str):
    """取向卡锚点用全角斜杠分段，复合值再用间隔号拆开。"""
    return [x.strip() for x in re.split(r"[／/、·]", clean(v)) if x.strip()]


def norm_rule(v: str) -> str:
    v = clean(v)
    return "现实写实" if v == "写实" else v


def field_values(text: str, name: str):
    table = pick(parse_tables(text), "字段", "类别", "取值")
    row = next((r for r in table[1:] if clean(r[0]) == name), None)
    if not row:
        raise KeyError("未找到四字段行：" + name)
    return split_multi(row[2])


def era_overlap(card_era: str, selected_era: str) -> bool:
    """国外卡用年代区间（如 1940s–1950s），字段值可能是相邻区间或单值。"""
    if card_era == selected_era:
        return True
    a = [x.strip() for x in card_era.replace("–", "-").split("-") if x.strip()]
    b = [x.strip() for x in selected_era.replace("–", "-").split("-") if x.strip()]
    if len(a) == 1 and len(b) == 1:
        return False
    return any(x in b for x in a)


def parse_cn_cards(text: str):
    table = pick(parse_tables(text), "锚点", "音阶调式")
    cards = []
    for i, r in enumerate(table[1:], 1):
        if len(r) < 5:
            continue
        anchor = clean(r[0])
        parts = split_multi(anchor)
        if len(parts) != 3:
            raise ValueError("中国题材卡锚点不是三段：" + anchor)
        head, rule, timbre = parts
        if "·" in head:
            era, theme = head.split("·", 1)
            key = head
        elif head.startswith("重大"):
            era, theme = "重大", head
            key = "重大·" + head[len("重大"):]
        else:
            raise ValueError("中国题材卡锚点无法解析：" + anchor)
        cards.append({
            "id": "cn-%02d" % i,
            "anchor": anchor,
            "scale": clean(r[1]),
            "instruments": clean(r[2]),
            "texture": clean(r[3]),
            "excludes": clean(r[4]),
            "match": {
                "theme_keys": [key], "era": era, "theme": theme,
                "rule": [norm_rule(rule)], "timbre": split_tokens(timbre),
                "restricted": era == "重大",
            },
        })
    return cards


def parse_intl_cards(text: str):
    table = pick(parse_tables(text), "锚点", "音阶调式")
    cards = []
    for i, r in enumerate(table[1:], 1):
        if len(r) < 5:
            continue
        anchor = clean(r[0])
        parts = split_multi(anchor)
        if len(parts) != 4:
            raise ValueError("国外题材卡锚点不是四段：" + anchor)
        genres, era, rule, timbre = parts
        cards.append({
            "id": "intl-%02d" % i,
            "anchor": anchor,
            "scale": clean(r[1]),
            "instruments": clean(r[2]),
            "texture": clean(r[3]),
            "excludes": clean(r[4]),
            "match": {
                "genre_keys": [g.strip() for g in genres.split("·") if g.strip()],
                "era": era, "rule": [norm_rule(rule)],
                "timbre": split_tokens(timbre),
            },
        })
    return cards


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

# 2. 共享层：八桶 / Russell 28 词母表 / 校验规则接口（只取编号与名称）
# 2026-11-12 库内改版：桶表头由「桶位｜象限｜轴｜目标情绪状态｜戏剧功能」改为
# 「桶位｜论文类·角度｜目标情绪状态｜覆盖词｜数｜戏剧功能」。派生口径改按新表头取值，
# 下游（render.py / cli.py）只认 id 与 target，故 quadrant/axis 继续保留为兼容字段。
et = parse_tables(src["shared_emotion"]["text"])
buckets = []
for r in pick(et, "桶位", "目标情绪状态")[1:]:
    if len(r) < 3:
        continue
    cls_angle = clean(r[1])
    cls, _, angle = cls_angle.partition("·")
    buckets.append({
        "id": clean(r[0]), "quadrant": cls.strip(), "axis": angle.strip(),
        "target": clean(r[2]),
        "words": clean(r[3]) if len(r) > 3 else "",
        "count": clean(r[4]) if len(r) > 4 else "",
        "dramatic": clean(r[5]) if len(r) > 5 else "",
    })
if len(buckets) != 8:
    raise ValueError("八桶不是 8 行：" + str(len(buckets)))

r28 = []
for r in pick(et, "序", "词", "归桶")[1:]:
    if len(r) >= 5 and clean(r[0]).isdigit():
        r28.append({"n": int(clean(r[0])), "word": clean(r[1]), "zh": clean(r[2]),
                    "quadrant": clean(r[3]), "bucket": clean(r[4])})
r28.sort(key=lambda x: x["n"])
if len(r28) != 28:
    raise ValueError("Russell 28 词母表不是 28 词：" + str(len(r28)))

rules = [{"n": int(m.group(1)), "name": m.group(2).strip()}
         for m in re.finditer(r"^\s*(\d+)\.\s+\*\*(.+?)\*\*",
                              section(src["shared_emotion"]["text"], "校验规则"), re.M)]

# 3. 共享层：28 词基线 / 全局设定 / 单集词映射 / 命名格式槽位 / 流程与闸门
ct = parse_tables(src["shared_cue"]["text"])
cue_baseline = []
for r in pick(ct, "桶位", "BPM")[1:]:
    if len(r) >= 9 and clean(r[0]).isdigit():
        word, zh = clean(r[1]), clean(r[2])
        cue_baseline.append({
            "bucket": clean(r[3]),
            "topic": (word + " " + zh).strip(),
            "mood_words": word,
            "bpm": clean(r[5]), "duration": clean(r[6]),
            "instruments": clean(r[7]),
            "use": clean(r[8]),
        })
if len(cue_baseline) != 28:
    raise ValueError("28 词基线不是 28 行：" + str(len(cue_baseline)))

global_settings = [{"field": clean(r[0]), "value": clean(r[1])}
                   for r in pick(ct, "项目", "设定")[1:] if len(r) >= 2]

episode_map = [{"segment": clean(r[0]), "span": clean(r[1]),
                "cue": clean(r[2]), "edit": clean(r[3])}
               for r in pick(ct, "单集段落", "剪辑要点")[1:] if len(r) >= 4]

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
    "forbidden_source": "5-领域-A/06-软件制作/85-配乐提示词生成器方案/01-方案详版-界面映射与D1-D4.md（硬线三）",
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

# 6. 参考口径的七层字段位名称（项目 85 方案详版；原项目 83 参考件已随目录删除）
ref = src["reference_item"]["text"]
m7 = re.search(r"七层字段骨架：([^\n]+)", ref)
if not m7:
    raise ValueError("方案详版未检出七层字段骨架行")
field_names = [x.strip() for x in m7.group(1).split("／") if x.strip()]
SEVEN_LAYER_NAMES = ["用途剖面", "画面功能", "情绪层", "声音层", "参数层", "参数偏离", "排除项"]
seven_layer = [n for n in field_names if n in SEVEN_LAYER_NAMES]
if len(seven_layer) != 7:
    raise ValueError("七层字段位未解析完整：" + str(seven_layer))

# 7. 题材层：中国版（默认）与国外版，只读解析四字段、取向卡与覆盖缺口
cn_text = src["theme_cn"]["text"]
intl_text = src["theme_intl"]["text"]

cn_era_table = pick(parse_tables(cn_text), "时代大类", "允许的题材锚点")
cn_era_map = []
for r in cn_era_table[1:]:
    label = clean(r[0])
    restricted = "另行办理" in label
    era = "重大" if restricted else label.split("（")[0].strip()
    anchors = [x.strip() for x in clean(r[1]).split("；")[0].split("、") if x.strip()]
    cn_era_map.append({
        "era": era, "label": label, "restricted": restricted,
        "anchors": anchors,
    })
if sum(len(e["anchors"]) for e in cn_era_map) != 28:
    raise ValueError("中国题材锚点不是 28 个：" +
                     str([(e["era"], len(e["anchors"])) for e in cn_era_map]))

cn_fields = [
    {"key": "era", "label": "时代大类",
     "options": [e["era"] for e in cn_era_map if not e["restricted"]]},
    {"key": "anchor", "label": "题材锚点", "depends_on": "era",
     "options_by": {e["era"]: e["anchors"] for e in cn_era_map if not e["restricted"]}},
    {"key": "rule", "label": "世界规则", "options": field_values(cn_text, "世界规则")},
    {"key": "timbre", "label": "文化音色域", "options": field_values(cn_text, "文化音色域")},
]

cn_cards = parse_cn_cards(cn_text)
if len(cn_cards) != 10:
    raise ValueError("中国题材取向卡不是 10 张：" + str(len(cn_cards)))

cn_card_keys = {k for c in cn_cards for k in c["match"]["theme_keys"]}
cn_themes = []
for e in cn_era_map:
    for a in e["anchors"]:
        prefix = e["era"] if e["era"] != "重大" else "重大"
        short = a[len(prefix):] if a.startswith(prefix) else a
        key = e["era"] + "·" + short.replace("题材", "")
        cn_themes.append({
            "era": e["era"], "anchor": a, "key": key,
            "has_card": key in cn_card_keys,
            "fallback": a.endswith("其它"), "restricted": e["restricted"],
        })
cn_gaps = len(cn_themes) - sum(1 for t in cn_themes if t["has_card"])
cn_fallback = sum(1 for t in cn_themes if t["fallback"])
cn_coverage = {
    "themes": cn_themes,
    "total": len(cn_themes),
    "with_card": sum(1 for t in cn_themes if t["has_card"]),
    "cards": len(cn_cards),
    "gaps": cn_gaps,
    "fallback": cn_fallback,
    "real_gaps": cn_gaps - cn_fallback,
    "restricted": sum(1 for t in cn_themes if t["restricted"]),
}

intl_genre_table = pick(parse_tables(intl_text), "类型", "取值", "数量")
intl_genres = []
for r in intl_genre_table[1:]:
    kind_raw = clean(r[0])
    kind = "Objective" if kind_raw.startswith("Objective") else "Subjective"
    for g in split_multi(r[1]):
        intl_genres.append({"id": g, "kind": kind})
if len(intl_genres) != 28:
    raise ValueError("IMDb 一级题材不是 28 类：" + str(len(intl_genres)))

intl_fields = [
    {"key": "genre_primary", "label": "叙事类型锚点（主类型）",
     "options": [g["id"] for g in intl_genres]},
    {"key": "genre_secondary", "label": "次类型（≤1，可空）",
     "options": [g["id"] for g in intl_genres], "allow_empty": True, "empty_label": "无"},
    {"key": "era", "label": "Era / Decade", "options": field_values(intl_text, "Era / Decade")},
    {"key": "rule", "label": "世界规则", "options": field_values(intl_text, "世界规则")},
    {"key": "timbre", "label": "文化音色域", "options": field_values(intl_text, "文化音色域")},
]

intl_cards = parse_intl_cards(intl_text)
if len(intl_cards) != 10:
    raise ValueError("国外题材取向卡不是 10 张：" + str(len(intl_cards)))

intl_genre_ids = {g["id"] for g in intl_genres}
intl_card_genres = {g for c in intl_cards for g in c["match"]["genre_keys"]}
intl_themes = [{"genre": g["id"], "kind": g["kind"],
                "has_card": g["id"] in intl_card_genres} for g in intl_genres]
intl_coverage = {
    "themes": intl_themes,
    "total": len(intl_themes),
    "with_card": sum(1 for t in intl_themes if t["has_card"]),
    "cards": len(intl_cards),
    "gaps": sum(1 for t in intl_themes if not t["has_card"]),
    "orphan_cards": [c["id"] for c in intl_cards
                     if not any(g in intl_genre_ids for g in c["match"]["genre_keys"])],
}

coverage_all = {
    "templates": 2,
    "themes": cn_coverage["total"] + intl_coverage["total"],
    "with_card": cn_coverage["with_card"] + intl_coverage["with_card"],
    "gaps": cn_coverage["gaps"] + intl_coverage["gaps"],
    "real_gaps": cn_coverage["real_gaps"] + intl_coverage["gaps"],
    "cards": cn_coverage["cards"] + intl_coverage["cards"],
}

cn_default = {"era": "当代", "anchor": "当代都市", "rule": "现实写实", "timbre": "无特定"}
intl_default = {"genre_primary": "Documentary", "genre_secondary": "",
                "era": "2000s 至今", "rule": "现实写实", "timbre": "无特定"}


def card_id_by_anchor(cards, anchor):
    card = next((c for c in cards if c["anchor"] == clean(anchor)), None)
    if not card:
        raise ValueError("默认取向卡不存在：" + anchor)
    return card["id"]


theme_templates = {
    "schema": "p85-theme-templates-v1",
    "matcher_version": "p85-theme-match-v1",
    "default": "nrta-cn-drama",
    "coverage": coverage_all,
    "templates": [
        {
            "id": "nrta-cn-drama",
            "name": "中国影视配乐题材分类模板（广电）",
            "source": src["theme_cn"]["path"],
            "source_sha256": src["theme_cn"]["sha256"],
            "status": "已实测验收",
            "verified": True,
            "default": True,
            "note": ("重大题材（重大革命／重大历史）须人类裁决，不进入本界面常规四字段；"
                     "重大历史卡仅在数据层保留。"),
            "fields": cn_fields,
            "era_map": cn_era_map,
            "cards": cn_cards,
            "coverage": cn_coverage,
            "default_s15": cn_default,
            "default_card_id": card_id_by_anchor(cn_cards, "当代·都市／写实／无特定"),
        },
        {
            "id": "intl-imdb-production",
            "name": "国外影视题材分类模板",
            "source": src["theme_intl"]["path"],
            "source_sha256": src["theme_intl"]["sha256"],
            "status": "待实测验收",
            "verified": False,
            "default": False,
            "note": ("卡集未实测验收；Spy·Heist、Synthwave 两张卡不对应 IMDb 一级题材，"
                     "只走 cue 备注；无卡题材按模板 §6 不生成。"),
            "fields": intl_fields,
            "genres": intl_genres,
            "cards": intl_cards,
            "coverage": intl_coverage,
            "default_s15": intl_default,
            "default_card_id": card_id_by_anchor(
                intl_cards, "Documentary / 2000s 至今 / 写实 / 无特定"),
        },
    ],
}

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
    "theme_templates": ds("theme_cn", theme_templates, {
        "source_files": [src["theme_cn"]["path"], src["theme_intl"]["path"]],
    }),
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
    "project": "5-领域-A/06-软件制作/85-配乐提示词生成器方案",
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
print("THEMES", [(t["id"], t["status"], len(t["cards"])) for t in theme_templates["templates"]])
print("COVERAGE", coverage_all)
print("CN_COVERAGE", {k: cn_coverage[k] for k in
                      ("total", "with_card", "cards", "gaps", "real_gaps")})
print("INTL_COVERAGE", {k: intl_coverage[k] for k in ("total", "with_card", "cards", "gaps")})
print("LOCK", instrumental_lock["lyrics_box"], "|", instrumental_lock["mandatory_negative"])
print("DATA_JS_SHA", sha256(OUT / "data.js")[:16])
print("MANIFEST_SHA", sha256(OUT / "manifest.json")[:16])
