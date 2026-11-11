"""项目 85 · MCP 服务：stdio 与局域网 HTTP（Streamable HTTP / 旧版 SSE）。

所有工具都调用 scripts/cli.py，与 CLI 和 GUI 共用同一套渲染、取向卡与自检。
默认只监听 127.0.0.1；局域网模式需显式 --host 0.0.0.0，并强制 Bearer token
与私网来源限制。写入只发生在 state/exports、state/requests、state/selfchecks。
"""
from __future__ import annotations

import argparse
import hmac
import ipaddress
import json
import os
import pathlib
import queue
import secrets
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import cli  # noqa: E402

SERVER_NAME = "mus-prompt"
SERVER_VERSION = "0.2.0"
SUPPORTED_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
DEFAULT_VENDOR = "MUS Prompt（配乐提示词生成器）"

_CFG = cli._load_config().get("mcp", {})
DEFAULT_HOST = str(_CFG.get("host", "127.0.0.1"))
DEFAULT_PORT = int(_CFG.get("port", 8765))
DEFAULT_MAX_BODY = int(_CFG.get("max_body_bytes", 1024 * 1024))
DEFAULT_ALLOW_PUBLIC = bool(_CFG.get("allow_public", False))

TOOLS = [
    {
        "name": "get_status",
        "description": "读取数据版本、模型状态、题材覆盖与运行态目录。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "list_templates",
        "description": "列出中国／世界题材模板、S1.5 默认值与取向卡数量。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_fields",
        "description": "读取指定模板的 S1.5 四字段受控词表与可用取向卡。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "template_id": {"type": "string"},
                "era": {"type": "string", "description": "中国模板可选；用于返回该时代的题材锚点"},
            },
            "required": ["template_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_cues",
        "description": "读取共享层 13 条基线；from_data 必须与其中一行完全一致。",
        "inputSchema": {
            "type": "object",
            "properties": {"bucket": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "get_selection_schema",
        "description": "返回 selection 的 JSON Schema 与受控枚举，供调用方构造合法输入。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "resolve_selection",
        "description": "校验四字段并自动命中取向卡，返回补全 card_* 的 selection；不落盘成品。",
        "inputSchema": {
            "type": "object",
            "properties": {"selection": {"type": "object", "description": "selection JSON 对象"}},
            "required": ["selection"],
            "additionalProperties": False,
        },
    },
    {
        "name": "render_prompt",
        "description": "自动选卡并落盘 1 条 -Suno.md，返回自检摘要与完整 Markdown；无卡或校验失败不生成。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "selection": {"type": "object", "description": "selection JSON 对象"},
                "name": {"type": "string", "description": "可选产物名；自动补 -Suno.md，重名自动加序号"},
            },
            "required": ["selection"],
            "additionalProperties": False,
        },
    },
]


def dispatch_tool(name: str, args: dict) -> dict:
    try:
        if name == "get_status":
            return cli.get_status()
        if name == "list_templates":
            return cli.list_templates()
        if name == "get_fields":
            return cli.get_fields(args.get("template_id", ""), args.get("era"))
        if name == "list_cues":
            return cli.list_cues(args.get("bucket"))
        if name == "get_selection_schema":
            return cli.get_selection_schema()
        if name == "resolve_selection":
            selection = args.get("selection")
            if not isinstance(selection, dict):
                return cli.err("INVALID_SELECTION", "selection 必须是对象")
            return cli.resolve_selection(selection)
        if name == "render_prompt":
            selection = args.get("selection")
            if not isinstance(selection, dict):
                return cli.err("INVALID_SELECTION", "selection 必须是对象")
            return cli.render_prompt(selection, args.get("name"))
        return cli.err("UNKNOWN_TOOL", f"未知工具：{name}")
    except cli.InputError as e:
        return cli.err(e.code, e.message, e.details)
    except Exception as e:  # 协议边界不返回 traceback
        return cli.err("INTERNAL_ERROR", str(e))


def _rpc_error(msg_id, code: int, message: str, data=None) -> dict:
    error = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": msg_id, "error": error}


def handle_message(msg) -> dict | None:
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
        return _rpc_error(msg.get("id") if isinstance(msg, dict) else None, -32600, "Invalid Request")
    method = msg["method"]
    params = msg.get("params") or {}
    is_notification = "id" not in msg
    msg_id = msg.get("id")

    if is_notification:
        return None

    if method == "initialize":
        requested = params.get("protocolVersion")
        version = requested if requested in SUPPORTED_VERSIONS else "2025-03-26"
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                "instructions": (
                    "MUS Prompt 只产 Suno 器乐提示词。先 get_status／list_templates／get_fields／"
                    "list_cues 取受控值，再用 resolve_selection 确认取向卡，最后 render_prompt 自动落盘。"
                    "from_data 必须与 cues 的一行完全一致；无取向卡时不生成。"
                ),
            },
        }
    if method == "ping":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        if not isinstance(name, str) or not isinstance(args, dict):
            return _rpc_error(msg_id, -32602, "Invalid params")
        result = dispatch_tool(name, args)
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}],
                "isError": not bool(result.get("ok")),
            },
        }
    if method in ("resources/list",):
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"resources": []}}
    if method in ("prompts/list",):
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"prompts": []}}
    return _rpc_error(msg_id, -32601, f"Method not found: {method}")


def handle_payload(payload):
    if isinstance(payload, list):
        out = [r for r in (handle_message(m) for m in payload) if r is not None]
        return out or None
    return handle_message(payload)


def _write_stdout(obj) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def run_stdio() -> int:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stderr.reconfigure(encoding="utf-8")
    print(f"[mcp] stdio ready · {SERVER_NAME} {SERVER_VERSION}", file=sys.stderr)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            _write_stdout(_rpc_error(None, -32700, "Parse error"))
            continue
        response = handle_payload(payload)
        if response is not None:
            _write_stdout(response)
    return 0


# ---------------------------------------------------------------- HTTP / SSE

SESSIONS: dict[str, dict] = {}
SESSIONS_LOCK = threading.Lock()
RENDER_LOCK = threading.Semaphore(2)


class HttpState:
    token = ""
    allow_public = False
    max_body = DEFAULT_MAX_BODY
    host = DEFAULT_HOST
    port = DEFAULT_PORT
    started = time.time()
    instance_id = uuid.uuid4().hex


def load_token(path: pathlib.Path) -> str:
    env_token = os.environ.get("MUS_MCP_TOKEN")
    if env_token:
        return env_token.strip()
    if path.is_file():
        token = path.read_text(encoding="utf-8").strip()
        if token:
            return token
    token = secrets.token_urlsafe(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(token + "\n", encoding="utf-8", newline="\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return token


def _is_private(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = f"{SERVER_NAME}/{SERVER_VERSION}"

    def log_message(self, fmt, *args):
        print(f"[mcp] {self.client_address[0]} {fmt % args}", file=sys.stderr)

    def _json(self, status: int, obj, extra_headers=None) -> None:
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if not _is_private(self.client_address[0]) and not HttpState.allow_public:
            self._json(403, {"error": "forbidden", "message": "只允许本机或私网地址；如需公网请显式 --allow-public"})
            return False
        auth = self.headers.get("Authorization", "")
        token = HttpState.token
        if not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:].strip(), token):
            self._json(401, {"error": "unauthorized", "message": "需要 Authorization: Bearer <token>"},
                       {"WWW-Authenticate": "Bearer"})
            return False
        return True

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            return None
        if length > HttpState.max_body:
            self._json(413, {"error": "payload_too_large", "message": f"超过 {HttpState.max_body} 字节"})
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"error": "invalid_json"})
            return None

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/health":
            if not self._authorized():
                return
            self._json(200, {
                "ok": True,
                "server": SERVER_NAME,
                "version": SERVER_VERSION,
                "uptime_seconds": int(time.time() - HttpState.started),
                "bind": f"{HttpState.host}:{HttpState.port}",
                "tools": [t["name"] for t in TOOLS],
            })
            return
        if path == "/sse":
            if not self._authorized():
                return
            self._serve_sse()
            return
        if path == "/mcp":
            self._json(405, {"error": "method_not_allowed",
                             "message": "MCP Streamable HTTP 使用 POST /mcp；旧版 SSE 使用 GET /sse"})
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path not in ("/mcp", "/messages"):
            self._json(404, {"error": "not_found"})
            return
        if not self._authorized():
            return
        payload = self._read_json()
        if payload is None:
            if self.headers.get("Content-Length", "0") == "0":
                self._json(400, {"error": "empty_body"})
            return
        if path == "/messages":
            self._post_sse_message(payload)
            return
        if not RENDER_LOCK.acquire(timeout=30):
            self._json(429, {"error": "busy", "message": "并发生成超过上限，请重试"})
            return
        try:
            response = handle_payload(payload)
        finally:
            RENDER_LOCK.release()
        if response is None:
            self.send_response(202)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        accept = self.headers.get("Accept", "")
        if "text/event-stream" in accept and "application/json" not in accept:
            self._send_stream(response)
        else:
            headers = {"Mcp-Session-Id": HttpState.instance_id}
            self._json(200, response, headers)

    def _send_stream(self, response) -> None:
        items = response if isinstance(response, list) else [response]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("Mcp-Session-Id", HttpState.instance_id)
        self.end_headers()
        for item in items:
            data = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
            self.wfile.write(f"event: message\ndata: {data}\n\n".encode("utf-8"))
        self.close_connection = True

    def _serve_sse(self) -> None:
        sid = uuid.uuid4().hex
        q: queue.Queue = queue.Queue()
        with SESSIONS_LOCK:
            SESSIONS[sid] = {"queue": q, "created": time.time()}
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(f"event: endpoint\ndata: /messages?session_id={sid}\n\n".encode("utf-8"))
            self.wfile.flush()
            while True:
                try:
                    item = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    continue
                data = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
                self.wfile.write(f"event: message\ndata: {data}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with SESSIONS_LOCK:
                SESSIONS.pop(sid, None)

    def _post_sse_message(self, payload) -> None:
        from urllib.parse import parse_qs, urlparse
        sid = parse_qs(urlparse(self.path).query).get("session_id", [""])[0]
        with SESSIONS_LOCK:
            session = SESSIONS.get(sid)
        if not session:
            self._json(404, {"error": "session_not_found"})
            return
        acquired = RENDER_LOCK.acquire(timeout=30)
        if not acquired:
            self._json(429, {"error": "busy"})
            return
        try:
            response = handle_payload(payload)
        finally:
            RENDER_LOCK.release()
        if response is not None:
            for item in (response if isinstance(response, list) else [response]):
                session["queue"].put(item)
        self.send_response(202)
        self.send_header("Content-Length", "0")
        self.end_headers()


def run_http(host: str, port: int, token_path: pathlib.Path, allow_public: bool,
             max_body: int) -> int:
    HttpState.token = load_token(token_path)
    HttpState.allow_public = allow_public
    HttpState.max_body = max_body
    HttpState.host = host
    HttpState.port = port
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    print(f"[mcp] {SERVER_NAME} {SERVER_VERSION} listening on http://{host}:{port}/mcp", file=sys.stderr)
    print(f"[mcp] token file: {token_path}", file=sys.stderr)
    print(f"[mcp] LAN clients: Authorization: Bearer <token from token file>", file=sys.stderr)
    if host not in ("127.0.0.1", "localhost", "::1"):
        print("[mcp] WARNING: 非本机绑定；请确认处于可信私网，并允许防火墙入站", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[mcp] stopping", file=sys.stderr)
    finally:
        server.server_close()
    return 0


def main(argv=None) -> int:
    cfg = cli._load_config().get("mcp", {})
    p = argparse.ArgumentParser(description="MUS Prompt MCP 服务（stdio / 局域网 HTTP）")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--stdio", action="store_true", help="stdio JSON-RPC（默认）")
    mode.add_argument("--http", action="store_true", help="局域网 HTTP MCP")
    p.add_argument("--host", default=cfg.get("host", DEFAULT_HOST))
    p.add_argument("--port", type=int, default=int(cfg.get("port", DEFAULT_PORT)))
    p.add_argument("--token-file", default=cfg.get("token_file", "config/mcp.token"))
    p.add_argument("--allow-public", action="store_true", default=bool(cfg.get("allow_public", False)))
    p.add_argument("--max-body", type=int, default=int(cfg.get("max_body_bytes", DEFAULT_MAX_BODY)))
    p.add_argument("--show-token", action="store_true", help="HTTP 启动时把 token 打到 stderr（本机可见）")
    args = p.parse_args(argv)

    if not args.http:
        return run_stdio()

    token_path = pathlib.Path(args.token_file)
    if not token_path.is_absolute():
        token_path = cli.BASE / token_path
    token = load_token(token_path)
    if args.show_token:
        print(f"[mcp] token: {token}", file=sys.stderr)
    return run_http(args.host, args.port, token_path, args.allow_public, args.max_body)


if __name__ == "__main__":
    sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
