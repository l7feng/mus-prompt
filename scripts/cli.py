"""项目 85 · 机器接入层：CLI 与 MCP 共用的调用入口。

复用 scripts/render.py 的解析、取向卡匹配与静态自检，不复制词表或匹配逻辑。
CLI 示例：
    python scripts/cli.py status
    python scripts/cli.py templates
    python scripts/cli.py fields --template nrta-cn-drama --era 当代
    python scripts/cli.py cues --bucket 01-日常温情
    python scripts/cli.py resolve --selection sel.json
    python scripts/cli.py render --selection sel.json --name ai-demo
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

BASE = pathlib.Path(__file__).resolve().parents[1]
DERIVED = BASE / "build"
CONFIG_LOCAL = BASE / "config/config.local.json"
DEFAULT_NOTE = "AI／MCP 调用；词表与取向卡来自 data.js 派生数据"
NEGATIVE_GROUPS = ("A", "B", "C", "D", "E")


class InputError(Exception):
    def __init__(self, code: str, message: str, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def _load_config() -> dict:
    if CONFIG_LOCAL.is_file():
        try:
            return json.loads(CONFIG_LOCAL.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


_CONFIG = _load_config()
STATE = pathlib.Path(os.environ.get("P85_STATE_HOME") or _CONFIG.get("state_home") or (BASE / "state"))
EXPORTS = STATE / "exports"
REQUESTS = STATE / "requests"
SELFCHECKS = STATE / "selfchecks"


def load_data() -> dict:
    txt = (DERIVED / "data.js").read_text(encoding="utf-8")
    marker = "const P85_DATA = "
    if marker not in txt:
        raise InputError("DATA_INVALID", "data.js 缺少 P85_DATA 赋值")
    data, _ = json.JSONDecoder().raw_decode(txt[txt.index(marker) + len(marker):])
    return data


def load_manifest() -> dict:
    return json.loads((DERIVED / "manifest.json").read_text(encoding="utf-8"))


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def ok(data=None, warnings=None) -> dict:
    return {"ok": True, "data": data or {}, "warnings": warnings or []}


def err(code: str, message: str, details=None) -> dict:
    return {"ok": False, "error": {"code": code, "message": message, "details": details or {}}}


def _now_id() -> str:
    return "AI-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]


def _text(value, label: str, max_len: int = 200, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise InputError("INVALID_SELECTION", f"{label} 必须是字符串")
    value = value.strip()
    if not value and not allow_empty:
        raise InputError("INVALID_SELECTION", f"{label} 不能为空")
    if "\n" in value or "\r" in value:
        raise InputError("INVALID_SELECTION", f"{label} 不能包含换行")
    if len(value) > max_len:
        raise InputError("INVALID_SELECTION", f"{label} 超过 {max_len} 字符")
    return value


def _text_list(value, label: str, max_items: int, max_len: int = 200) -> list[str]:
    if not isinstance(value, list) or not value:
        raise InputError("INVALID_SELECTION", f"{label} 必须是非空数组")
    if len(value) > max_items:
        raise InputError("INVALID_SELECTION", f"{label} 最多 {max_items} 项")
    return [_text(v, f"{label}[{i}]", max_len) for i, v in enumerate(value)]


def safe_stem(name, default: str) -> str:
    raw = str(name or "").strip() or default
    if raw.lower().endswith(".md"):
        raw = raw[:-3]
    raw = re.sub(r"[^\w\u4e00-\u9fff.\- ]+", "-", raw, flags=re.UNICODE).strip(" .-")
    if not raw:
        raw = default
    if raw.endswith("-Suno"):
        raw = raw[:-5]
    raw = raw.strip(" .-")[:70] or default
    return f"{raw}-Suno"


def ensure_unique(path: pathlib.Path) -> pathlib.Path:
    if not path.exists():
        return path
    stem = path.stem
    tail = "-Suno" if stem.endswith("-Suno") else ""
    base = stem[: -len(tail)] if tail else stem
    for i in range(2, 1000):
        candidate = path.with_name(f"{base}-{i}{tail}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise InputError("OUTPUT_EXISTS", f"无法为 {path.name} 找到未占用的文件名")


def _baseline_rows(data: dict) -> list[dict]:
    return data["cue_baseline"]["values"]


def normalize_selection(selection, data: dict) -> dict:
    if not isinstance(selection, dict):
        raise InputError("INVALID_SELECTION", "selection 必须是 JSON 对象")

    sel_id = selection.get("selection_id") or _now_id()
    source_note = selection.get("source_note") or DEFAULT_NOTE

    fd = selection.get("from_data")
    if not isinstance(fd, dict):
        raise InputError("INVALID_SELECTION", "缺少 from_data 对象")
    mood_words = _text_list(fd.get("mood_words"), "from_data.mood_words", 8, 40)
    from_data = {
        "bucket": _text(fd.get("bucket"), "from_data.bucket", 40),
        "topic": _text(fd.get("topic"), "from_data.topic", 60),
        "mood_words": mood_words,
        "instruments": _text(fd.get("instruments"), "from_data.instruments", 200),
        "bpm": _text(fd.get("bpm"), "from_data.bpm", 20),
        "duration": _text(fd.get("duration"), "from_data.duration", 20),
    }

    rows = _baseline_rows(data)
    matched = [r for r in rows
               if r["bucket"] == from_data["bucket"] and r["topic"] == from_data["topic"]
               and r["instruments"] == from_data["instruments"] and r["bpm"] == from_data["bpm"]
               and r["duration"] == from_data["duration"]
               and r["mood_words"] == " / ".join(from_data["mood_words"])]
    if len(matched) != 1:
        topics = [r["topic"] for r in rows if r["bucket"] == from_data["bucket"]]
        raise InputError(
            "BASELINE_MISMATCH",
            "from_data 未命中共享层基线；请先调用 cues 命令取完整一行，不要自行组合",
            {"bucket": from_data["bucket"], "topics": topics},
        )

    typed = selection.get("typed")
    if not isinstance(typed, dict):
        raise InputError("INVALID_SELECTION", "缺少 typed 对象")
    groups = typed.get("negative_groups")
    if not isinstance(groups, list) or not groups:
        raise InputError("INVALID_SELECTION", "typed.negative_groups 必须是非空数组")
    groups = [_text(g, "typed.negative_groups", 4) for g in groups]
    if len(set(groups)) != len(groups):
        raise InputError("INVALID_SELECTION", "typed.negative_groups 不能重复")
    if len(groups) > 3:
        raise InputError("INVALID_SELECTION", "typed.negative_groups 最多 3 组")
    bad_groups = [g for g in groups if g not in NEGATIVE_GROUPS]
    if bad_groups:
        raise InputError("INVALID_SELECTION", "typed.negative_groups 只允许 A–E", {"bad": bad_groups})

    typed_out = {
        "purpose_profile": _text(typed.get("purpose_profile"), "typed.purpose_profile", 200),
        "picture_function": _text(typed.get("picture_function"), "typed.picture_function", 200),
        "mood_arc_zh": _text(typed.get("mood_arc_zh"), "typed.mood_arc_zh", 200),
        "parameter_deviation": _text(typed.get("parameter_deviation"), "typed.parameter_deviation", 300),
        "excludes": _text_list(typed.get("excludes"), "typed.excludes", 5, 200),
        "negative_groups": groups,
        "item_version": _text(typed.get("item_version"), "typed.item_version", 40),
    }

    theme = selection.get("theme")
    if not isinstance(theme, dict):
        raise InputError("INVALID_SELECTION", "缺少 theme 对象")
    template_id = _text(theme.get("template_id"), "theme.template_id", 80)
    fields = theme.get("fields")
    if not isinstance(fields, dict):
        raise InputError("INVALID_SELECTION", "缺少 theme.fields 对象")
    fields_out = {}
    for k, v in fields.items():
        if not re.fullmatch(r"[A-Za-z0-9_]+", str(k)):
            raise InputError("INVALID_SELECTION", f"theme.fields 键名非法：{k}")
        fields_out[str(k)] = _text(v, f"theme.fields.{k}", 80, allow_empty=True)

    return {
        "selection_id": _text(sel_id, "selection_id", 80),
        "source_note": _text(source_note, "source_note", 300),
        "from_data": from_data,
        "typed": typed_out,
        # card_* 由引擎解析后回填，忽略调用方自带值，避免与取向卡真源不一致。
        "theme": {"template_id": template_id, "fields": fields_out},
    }


def _run_render(selection: dict, out_dir: pathlib.Path, product_name: str,
                selfcheck_path: pathlib.Path, resolve_only: bool) -> dict:
    REQUESTS.mkdir(parents=True, exist_ok=True)
    tmp = REQUESTS / f".resolve-{uuid.uuid4().hex}.json"
    tmp.write_text(json.dumps(selection, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8", newline="\n")
    cmd = [
        sys.executable, str(BASE / "scripts/render.py"),
        "--selection", str(tmp),
        "--out", str(out_dir),
        "--product", product_name,
        "--selfcheck", str(selfcheck_path),
        "--stage", "C",
    ]
    if resolve_only:
        cmd.append("--resolve-only")
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    kwargs = {}
    if os.name == "nt":
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=90, env=env, **kwargs)
    except subprocess.TimeoutExpired:
        return {"ok": False, "code": "RENDER_TIMEOUT", "stdout": "", "stderr": "render.py 超时"}
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass

    if resolve_only:
        line = next((l for l in proc.stdout.splitlines() if l.startswith("RESOLVE_JSON ")), None)
        if not line:
            return {"ok": False, "code": "RENDER_FAILED",
                    "stdout": proc.stdout[-2000:], "stderr": proc.stderr[-2000:],
                    "returncode": proc.returncode}
        resolution = json.loads(line[len("RESOLVE_JSON "):])
        resolution["returncode"] = proc.returncode
        resolution["stderr"] = proc.stderr[-2000:]
        return resolution

    report = None
    if selfcheck_path.is_file():
        try:
            report = json.loads(selfcheck_path.read_text(encoding="utf-8"))
        except Exception:
            report = None
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": proc.stdout[-4000:],
        "stderr": proc.stderr[-4000:],
        "report": report,
    }


def _public_path(path: pathlib.Path) -> str:
    try:
        return path.resolve().relative_to(BASE.resolve()).as_posix()
    except ValueError:
        return str(path)


def _template_summary(tpl: dict) -> dict:
    themes = tpl.get("coverage", {}).get("themes", [])
    cards = tpl.get("cards", [])
    return {
        "id": tpl["id"],
        "name": tpl["name"],
        "status": tpl["status"],
        "verified": tpl.get("verified", False),
        "default": tpl.get("default", False),
        "default_s15": tpl.get("default_s15"),
        "default_card_id": tpl.get("default_card_id"),
        "card_count": len(cards),
        "theme_count": len(themes),
        "with_card": sum(1 for t in themes if t.get("has_card")),
        "gaps": sum(1 for t in themes if not t.get("has_card")),
        "fields": tpl.get("fields", []),
        "note": tpl.get("note", ""),
    }


def get_status() -> dict:
    data = load_data()
    manifest = load_manifest()
    tpls = data["theme_templates"]["values"]["templates"]
    return ok({
        "data_version": data["data_version"],
        "model": {"id": data["model"]["id"], "display": data["model"]["display"],
                  "status": data["model"]["status"], "product_suffix": data["product_suffix"]},
        "sources": len(manifest.get("sources", [])),
        "theme_coverage": data["theme_templates"]["values"]["coverage"],
        "templates": [_template_summary(t) for t in tpls],
        "state_home": str(STATE),
        "exports_dir": str(EXPORTS),
    })


def list_templates() -> dict:
    data = load_data()
    registry = data["theme_templates"]["values"]
    return ok({
        "data_version": data["data_version"],
        "default": registry.get("default"),
        "coverage": registry.get("coverage"),
        "templates": [_template_summary(t) for t in registry["templates"]],
    })


def get_fields(template_id: str, era: str | None = None) -> dict:
    data = load_data()
    tpl = next((t for t in data["theme_templates"]["values"]["templates"]
                if t["id"] == template_id), None)
    if not tpl:
        raise InputError("TEMPLATE_NOT_FOUND", f"未找到题材模板：{template_id}",
                         {"templates": [t["id"] for t in data["theme_templates"]["values"]["templates"]]})
    fields = []
    for f in tpl.get("fields", []):
        item = {k: v for k, v in f.items() if k != "options_by"}
        if era and f.get("options_by"):
            item["options_for_era"] = f["options_by"].get(era)
        fields.append(item)
    return ok({
        "template_id": tpl["id"],
        "status": tpl["status"],
        "verified": tpl.get("verified", False),
        "default_s15": tpl.get("default_s15"),
        "fields": fields,
        "cards": [{"id": c["id"], "anchor": c["anchor"]} for c in tpl.get("cards", [])],
        "coverage": _template_summary(tpl),
    })


def list_cues(bucket: str | None = None) -> dict:
    data = load_data()
    rows = data["cue_baseline"]["values"]
    if bucket:
        rows = [r for r in rows if r["bucket"] == bucket]
    cues = [{
        "bucket": r["bucket"],
        "topic": r["topic"],
        "use": r["use"],
        "mood_words": [w.strip() for w in r["mood_words"].split("/") if w.strip()],
        "instruments": r["instruments"],
        "bpm": r["bpm"],
        "duration": r["duration"],
    } for r in rows]
    buckets = [{"id": b["id"], "target": b["target"]} for b in data["buckets"]["values"]]
    return ok({"buckets": buckets, "cues": cues})


def resolve_selection(selection: dict) -> dict:
    data = load_data()
    try:
        sel = normalize_selection(selection, data)
    except InputError as e:
        return err(e.code, e.message, e.details)

    res = _run_render(sel, EXPORTS, "resolve-Suno.md",
                      SELFCHECKS / ".resolve.selfcheck.json", resolve_only=True)
    if "code" in res and not res.get("ok"):
        return err(res["code"], "渲染器解析失败", {"stderr": res.get("stderr", "")[-1000:]})
    if not res.get("ok"):
        code = "NO_CARD" if res.get("card") is None else "S1_5_INVALID"
        message = ("S1.5 未命中取向卡，按模板规则不生成；请调整四字段或切换模板"
                   if code == "NO_CARD" else "S1.5 四字段未通过受控词表校验")
        return err(code, message, {
            "template": res.get("template"),
            "fields": res.get("fields"),
            "fields_detail": res.get("fields_detail"),
            "failed_checks": res.get("failed_checks", []),
        })

    theme = sel["theme"]
    theme["template_status"] = res["template"]["status"]
    theme["verified"] = res["template"]["verified"]
    theme["card_id"] = res["card"]["id"]
    theme["card_anchor"] = res["card"]["anchor"]
    theme["card_override"] = res["override"]
    theme["card_candidates"] = res["candidates"]

    warnings = []
    if "待实测" in res["template"]["status"]:
        warnings.append({"code": "TEMPLATE_UNVERIFIED",
                         "message": f"{res['template']['id']} 的取向卡在真源中标注「{res['template']['status']}」，未做听感验收"})
    if res["override"]:
        warnings.append({"code": "TIMBRE_OVERRIDE",
                         "message": "音色域未命中，已按 §6.3 回落到「无特定」卡；主奏按项目 S0 乐器口径执行"})
    return ok({"selection": sel, "resolution": res}, warnings)


def render_prompt(selection: dict, name: str | None = None) -> dict:
    resolved = resolve_selection(selection)
    if not resolved["ok"]:
        return resolved
    sel = resolved["data"]["selection"]
    warnings = resolved["warnings"]

    stem = safe_stem(name, sel["selection_id"])
    EXPORTS.mkdir(parents=True, exist_ok=True)
    REQUESTS.mkdir(parents=True, exist_ok=True)
    SELFCHECKS.mkdir(parents=True, exist_ok=True)
    product = ensure_unique(EXPORTS / f"{stem}.md")
    stem = product.stem
    audit = REQUESTS / f"{stem}.selection.json"
    selfcheck = SELFCHECKS / f"{stem}.selfcheck.json"
    audit.write_text(json.dumps(sel, ensure_ascii=False, indent=2) + "\n",
                     encoding="utf-8", newline="\n")

    run = _run_render(sel, EXPORTS, product.name, selfcheck, resolve_only=False)
    report = run.get("report")
    if not run.get("ok") or not report or report.get("product") is None:
        details = {
            "returncode": run.get("returncode"),
            "stderr": run.get("stderr", "")[-1500:],
            "selfcheck": _public_path(selfcheck) if selfcheck.is_file() else None,
            "summary": report.get("summary") if report else None,
        }
        if report and report.get("blocked"):
            details["blocked"] = report["blocked"]
        return err("RENDER_FAILED", "渲染或静态自检未通过，成品未生成或未通过", details)

    product_path = EXPORTS / product.name
    text = product_path.read_text(encoding="utf-8")
    return ok({
        "request_id": stem,
        "product": {
            "name": product_path.name,
            "path": _public_path(product_path),
            "sha256": sha256_file(product_path),
            "bytes": product_path.stat().st_size,
            "markdown": text,
        },
        "selfcheck": {
            "path": _public_path(selfcheck),
            "summary": report.get("summary"),
            "s1_5": report.get("s1_5"),
            "not_tested": report.get("not_tested", []),
        },
        "selection_path": _public_path(audit),
        "data_version": report.get("data_version"),
    }, warnings)


def get_selection_schema() -> dict:
    data = load_data()
    templates = data["theme_templates"]["values"]["templates"]
    theme_variants = []
    for tpl in templates:
        props = {}
        required = []
        for f in tpl.get("fields", []):
            if f.get("options_by"):
                options = sorted({o for vals in f["options_by"].values() for o in vals})
            else:
                options = f.get("options", [])
            props[f["key"]] = {"type": "string", "enum": options}
            required.append(f["key"])
        theme_variants.append({
            "type": "object",
            "properties": {
                "template_id": {"const": tpl["id"]},
                "fields": {"type": "object", "properties": props, "required": required,
                           "additionalProperties": False},
            },
            "required": ["template_id", "fields"],
            "additionalProperties": False,
        })

    rows = _baseline_rows(data)
    buckets = [b["id"] for b in data["buckets"]["values"]]
    topics = sorted({r["topic"] for r in rows})
    instruments = sorted({r["instruments"] for r in rows})
    bpms = sorted({r["bpm"] for r in rows}, key=lambda x: int(x))
    durations = sorted({r["duration"] for r in rows})
    moods = sorted({w.strip() for r in rows for w in r["mood_words"].split("/") if w.strip()})

    return ok({
        "schema": {
            "type": "object",
            "properties": {
                "selection_id": {"type": "string", "maxLength": 80},
                "source_note": {"type": "string", "maxLength": 300},
                "theme": {"oneOf": theme_variants},
                "from_data": {
                    "type": "object",
                    "properties": {
                        "bucket": {"type": "string", "enum": buckets},
                        "topic": {"type": "string", "enum": topics},
                        "mood_words": {"type": "array", "items": {"type": "string", "enum": moods}},
                        "instruments": {"type": "string", "enum": instruments},
                        "bpm": {"type": "string", "enum": bpms},
                        "duration": {"type": "string", "enum": durations},
                    },
                    "required": ["bucket", "topic", "mood_words", "instruments", "bpm", "duration"],
                    "additionalProperties": False,
                },
                "typed": {
                    "type": "object",
                    "properties": {
                        "purpose_profile": {"type": "string", "maxLength": 200},
                        "picture_function": {"type": "string", "maxLength": 200},
                        "mood_arc_zh": {"type": "string", "maxLength": 200},
                        "parameter_deviation": {"type": "string", "maxLength": 300},
                        "excludes": {"type": "array", "minItems": 1, "maxItems": 5,
                                     "items": {"type": "string", "maxLength": 200}},
                        "negative_groups": {"type": "array", "minItems": 1, "maxItems": 3,
                                            "items": {"type": "string", "enum": list(NEGATIVE_GROUPS)}},
                        "item_version": {"type": "string", "maxLength": 40},
                    },
                    "required": ["purpose_profile", "picture_function", "mood_arc_zh",
                                 "parameter_deviation", "excludes", "negative_groups", "item_version"],
                    "additionalProperties": False,
                },
            },
            "required": ["theme", "from_data", "typed"],
            "additionalProperties": False,
        },
        "note": "from_data 必须与 cues 返回的某一行完全一致；theme.fields 必须落在对应模板受控词表内；card_* 由引擎解析，不需要传。",
    })


def _read_selection(path: str) -> dict:
    if path == "-":
        raw = sys.stdin.read()
    else:
        p = pathlib.Path(path)
        if not p.is_file():
            raise InputError("SELECTION_NOT_FOUND", f"selection 文件不存在：{path}")
        raw = p.read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise InputError("INVALID_JSON", f"selection 不是有效 JSON：{e}")


def _print(result: dict) -> int:
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("ok"):
        return 0
    return 1 if result.get("error", {}).get("code") in ("NO_CARD", "RENDER_FAILED") else 2


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="MUS Prompt 机器接入 CLI")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("status", help="数据版本、模型与题材覆盖")
    sub.add_parser("templates", help="题材模板清单")
    pc = sub.add_parser("fields", help="S1.5 四字段与取向卡")
    pc.add_argument("--template", required=True)
    pc.add_argument("--era")
    pq = sub.add_parser("cues", help="共享层 13 条基线")
    pq.add_argument("--bucket")
    sub.add_parser("schema", help="selection JSON Schema")
    for name in ("resolve", "render"):
        pr = sub.add_parser(name, help="解析取向卡" if name == "resolve" else "解析并自动落盘")
        pr.add_argument("--selection", required=True, help="selection JSON 路径，- 表示 stdin")
        if name == "render":
            pr.add_argument("--name", help="产物名，自动补 -Suno.md")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "status":
            result = get_status()
        elif args.command == "templates":
            result = list_templates()
        elif args.command == "fields":
            result = get_fields(args.template, args.era)
        elif args.command == "cues":
            result = list_cues(args.bucket)
        elif args.command == "schema":
            result = get_selection_schema()
        elif args.command == "resolve":
            result = resolve_selection(_read_selection(args.selection))
        elif args.command == "render":
            result = render_prompt(_read_selection(args.selection), args.name)
        else:
            result = err("UNKNOWN_COMMAND", "未知命令")
    except InputError as e:
        result = err(e.code, e.message, e.details)
    except Exception as e:  # 边界层兜底：不把 traceback 当协议输出
        result = err("INTERNAL_ERROR", str(e))
    return _print(result)


if __name__ == "__main__":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
