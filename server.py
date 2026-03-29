#!/usr/bin/env python3
"""
SmartNotes server

What this server provides:
- Static file hosting for the browser app
- Stable API gateway under /api/* (proxied to Ollama)
- Local control API for the CLI on 127.0.0.1:50002
- Optional MCP bridge lifecycle management
"""

import argparse
import http.server
import json
import logging
import os
import re
import shutil
import socketserver
import subprocess
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from urllib.parse import parse_qs, urlparse

from api_contracts import API_SCHEMA_VERSION, ContractValidationError, validate_api_request, validate_api_response

# Optional dependencies used by historical tray flow; kept optional.
try:
    import pystray  # noqa: F401
    from PIL import Image, ImageDraw  # noqa: F401
except Exception:
    pystray = None

APP_PORT = 8088
CONTROL_PORT = 50002
OLLAMA_BASE = os.environ.get("OLLAMA_BASE", "http://192.168.1.64:11434")
DEFAULT_MODEL = "llama2:7b"
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server_config.json")

MCP_PROCESS = None
MCP_LOG_THREAD = None
MCP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mcp-server")

HTTPD = None
CONTROL_HTTPD = None
IS_RUNNING = False
SERVER_THREAD = None
CONTROL_THREAD = None

NOTES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "notes")


def _normalize_origin(origin):
    return (origin or "").strip().rstrip("/").lower()


def _load_allowed_origins():
    raw = os.environ.get("SMARTNOTES_ALLOWED_ORIGINS", "")
    if not raw:
        # Safe-by-default local origins; override via env for intranet hostnames.
        defaults = [
            "http://localhost",
            "http://127.0.0.1",
            "http://localhost:8088",
            "http://127.0.0.1:8088",
        ]
        return {_normalize_origin(x) for x in defaults}

    if raw.strip() == "*":
        return {"*"}

    return {_normalize_origin(x) for x in raw.split(",") if x.strip()}


ALLOWED_ORIGINS = _load_allowed_origins()


def _is_origin_allowed(origin):
    if "*" in ALLOWED_ORIGINS:
        return True
    normalized = _normalize_origin(origin)
    if not normalized:
        return False
    return normalized in ALLOWED_ORIGINS


def _load_config():
    if not os.path.exists(CONFIG_FILE):
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        logging.exception("Failed to read config file")
        return {}


def _save_config(cfg):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh, indent=2)
    except Exception:
        logging.exception("Failed to save config file")


def get_default_model():
    cfg = _load_config()
    return cfg.get("selected_model") or cfg.get("default_model") or DEFAULT_MODEL


def set_default_model(model_name):
    cfg = _load_config()
    cfg["selected_model"] = model_name
    cfg["default_model"] = model_name
    _save_config(cfg)


def _slugify(value):
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", (value or "").strip())
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned or "untitled"


def _note_filename(note_obj):
    note_id = str(note_obj.get("id") or "no-id")
    title = _slugify(note_obj.get("title") or "untitled")
    return f"{note_id}__{title}.md"


def _ensure_notes_dir():
    os.makedirs(NOTES_DIR, exist_ok=True)


def _serialize_note_markdown(note_obj):
    meta = {
        "id": note_obj.get("id"),
        "title": note_obj.get("title"),
        "tags": note_obj.get("tags", []),
        "updatedAt": note_obj.get("updatedAt"),
        "folderId": note_obj.get("folderId"),
    }
    header = "---\n" + json.dumps(meta, ensure_ascii=True) + "\n---\n\n"
    return header + (note_obj.get("body") or "")


def _parse_note_markdown(raw_text):
    if not raw_text.startswith("---\n"):
        return None
    parts = raw_text.split("\n---\n", 1)
    if len(parts) != 2:
        return None

    meta_line = parts[0].replace("---\n", "", 1).strip()
    body = parts[1]
    try:
        meta = json.loads(meta_line)
    except Exception:
        return None

    return {
        "id": meta.get("id"),
        "title": meta.get("title") or "Untitled",
        "body": body,
        "tags": meta.get("tags") or [],
        "updatedAt": meta.get("updatedAt") or int(time.time() * 1000),
        "folderId": meta.get("folderId"),
    }


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class AppRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Main application handler for static files + /api routes."""

    server_version = "SmartNotesHTTP/1.0"

    def _set_cors_headers(self):
        origin = self.headers.get("Origin", "")
        if "*" in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", "*")
        elif origin and _is_origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def end_headers(self):
        self._set_cors_headers()
        # Baseline hardening for intranet deployment.
        host_header = (self.headers.get("Host") or "").strip()
        request_host = host_header.split(":", 1)[0].strip().lower()
        dynamic_connect_src = ""
        if request_host and request_host not in ("localhost", "127.0.0.1"):
            dynamic_connect_src = f" http://{request_host}:3000 ws://{request_host}:3000"

        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "img-src 'self' data: blob:; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; "
            "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdn.socket.io; "
            "connect-src 'self' http://localhost:3000 ws://localhost:3000 http://127.0.0.1:3000 ws://127.0.0.1:3000"
            + dynamic_connect_src
            + " https://cdn.jsdelivr.net https://unpkg.com https://cdn.socket.io "
            + OLLAMA_BASE
            + " ws: wss:;",
        )
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def _send_json(self, payload, status=200):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_api_json(self, path, payload, status=200):
        envelope = payload
        if isinstance(payload, dict):
            envelope = dict(payload)
            envelope.setdefault("schemaVersion", API_SCHEMA_VERSION)

        try:
            validate_api_response(path, envelope, status=status)
        except ContractValidationError as err:
            logging.error("API response contract violation for %s: %s", path, err.message)
            fallback = {"error": "Server response contract violation", "path": path, "schemaVersion": API_SCHEMA_VERSION}
            self._send_json(fallback, status=500)
            return

        self._send_json(envelope, status=status)

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return {}
        raw = self.rfile.read(content_length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _proxy_to_ollama(self, method, ollama_path, payload=None, stream=False):
        url = f"{OLLAMA_BASE}{ollama_path}"
        req_data = None
        if payload is not None:
            req_data = json.dumps(payload).encode("utf-8")

        req = urllib.request.Request(url, data=req_data, method=method)
        req.add_header("Content-Type", "application/json")

        try:
            with urllib.request.urlopen(req, timeout=90) as upstream:
                body = upstream.read()
                status = upstream.status
                ctype = upstream.headers.get("Content-Type", "application/json")

            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        except urllib.error.HTTPError as e:
            details = ""
            try:
                details = e.read().decode("utf-8", errors="replace")
            except Exception:
                details = str(e)
            self._send_json({"error": "Ollama HTTP error", "status": e.code, "details": details}, status=e.code)
            return
        except urllib.error.URLError as e:
            self._send_json(
                {
                    "error": "Ollama unreachable",
                    "details": str(e),
                    "endpoint": url,
                },
                status=502,
            )
            return
        except Exception as e:
            self._send_json({"error": "Proxy failure", "details": str(e)}, status=500)
            return

    def _handle_api_get(self, path, query):
        if path == "/api/default-model":
            self._send_api_json(path, {"model": get_default_model(), "source": "server"})
            return

        if path == "/api/tags":
            self._proxy_to_ollama("GET", "/api/tags")
            return

        if path == "/api/file-notes/load":
            _ensure_notes_dir()
            notes = []
            for name in os.listdir(NOTES_DIR):
                if not name.endswith(".md"):
                    continue
                fpath = os.path.join(NOTES_DIR, name)
                try:
                    with open(fpath, "r", encoding="utf-8") as fh:
                        parsed = _parse_note_markdown(fh.read())
                        if parsed:
                            notes.append(parsed)
                except Exception:
                    logging.exception("Failed loading note file: %s", fpath)
            self._send_api_json(path, {"notes": notes, "count": len(notes)})
            return

        self._send_api_json(path, {"error": "Not found", "path": path}, status=404)

    def _handle_api_post(self, path, body):
        try:
            body = validate_api_request("POST", path, body)
        except ContractValidationError as err:
            self._send_api_json(path, {"error": err.message, "details": err.details}, status=400)
            return

        model = body.get("model") or get_default_model()

        if path == "/api/generate":
            payload = {
                "model": model,
                "prompt": body.get("prompt", ""),
                "stream": bool(body.get("stream", False)),
            }
            if "keep_alive" in body:
                payload["keep_alive"] = body["keep_alive"]
            self._proxy_to_ollama("POST", "/api/generate", payload=payload, stream=payload["stream"])
            return

        if path == "/api/chat":
            messages = body.get("messages")
            payload = {
                "model": model,
                "messages": messages,
                "stream": bool(body.get("stream", False)),
            }
            self._proxy_to_ollama("POST", "/api/chat", payload=payload, stream=payload["stream"])
            return

        if path == "/api/embeddings":
            prompt = body.get("prompt") or body.get("input")
            payload = {
                "model": model,
                "prompt": prompt,
            }
            self._proxy_to_ollama("POST", "/api/embeddings", payload=payload)
            return

        if path == "/api/model":
            set_default_model(body["model"])
            self._send_api_json(path, {"ok": True, "model": body["model"]})
            return

        if path == "/api/file-notes/sync":
            notes = body.get("notes")
            api_path = path

            _ensure_notes_dir()

            written = []
            for note in notes:
                if not isinstance(note, dict):
                    continue
                if not note.get("id"):
                    continue
                filename = _note_filename(note)
                note_path = os.path.join(NOTES_DIR, filename)
                payload = _serialize_note_markdown(note)
                with open(note_path, "w", encoding="utf-8") as fh:
                    fh.write(payload)
                written.append(filename)

            self._send_api_json(api_path, {"ok": True, "written": len(written), "files": written})
            return

        self._send_api_json(path, {"error": "Not found", "path": path}, status=404)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path.startswith("/api/"):
            self._handle_api_get(path, query)
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            try:
                body = self._read_json_body()
            except Exception:
                self._send_api_json(path, {"error": "Invalid JSON body", "path": path}, status=400)
                return
            self._handle_api_post(path, body)
            return

        self._send_json({"error": "Not found", "path": path}, status=404)


class ControlRequestHandler(http.server.BaseHTTPRequestHandler):
    """Local-only control API used by cli.js."""

    def _send_json(self, payload, status=200):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _forbidden_if_not_local(self):
        host = self.client_address[0]
        if host not in ("127.0.0.1", "::1", "localhost"):
            self._send_json({"error": "forbidden"}, status=403)
            return True
        return False

    def do_GET(self):
        if self._forbidden_if_not_local():
            return

        if self.path == "/control/status":
            self._send_json(
                {
                    "is_running": IS_RUNNING,
                    "port": APP_PORT,
                    "model": get_default_model(),
                    "mcp_running": bool(MCP_PROCESS),
                }
            )
            return

        self._send_json({"error": "not found"}, status=404)

    def do_POST(self):
        if self._forbidden_if_not_local():
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json({"error": "invalid json"}, status=400)
            return

        action = data.get("action", "")

        try:
            if action == "start":
                start_server()
                self._send_json({"status": "started"})
                return
            if action == "stop":
                threading.Thread(target=stop_server, daemon=True).start()
                self._send_json({"status": "stopping"})
                return
            if action == "restart":
                def _restart():
                    stop_server()
                    time.sleep(0.3)
                    start_server()

                threading.Thread(target=_restart, daemon=True).start()
                self._send_json({"status": "restarting"})
                return
            if action == "open_browser":
                webbrowser.open(f"http://localhost:{APP_PORT}")
                self._send_json({"status": "browser_opened"})
                return
            if action == "open_logs":
                self._send_json({"status": "not_implemented", "details": "Live log window not implemented in this slim server"})
                return
            if action == "list_models":
                models = list_ollama_models()
                self._send_json({"models": models})
                return
            if action == "select_model":
                model = data.get("model")
                if not model:
                    self._send_json({"error": "model is required"}, status=400)
                    return
                set_default_model(model)
                self._send_json({"status": "model_selected", "model": model})
                return
            if action == "unload_model":
                model = data.get("model") or get_default_model()
                unload_model(model)
                self._send_json({"status": "unload_requested", "model": model})
                return

            self._send_json({"error": "invalid action"}, status=400)
        except Exception as e:
            self._send_json({"error": str(e)}, status=500)

    def log_message(self, fmt, *args):
        logging.debug("control: " + fmt, *args)


# ----------------------- MCP bridge lifecycle -----------------------

def _mcp_stream_reader(pipe):
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            logging.info("[MCP] %s", line.rstrip())
    except Exception:
        logging.exception("Error while reading MCP logs")
    finally:
        try:
            pipe.close()
        except Exception:
            pass


def install_mcp_dependencies():
    if not os.path.isdir(MCP_DIR):
        return False

    package_json = os.path.join(MCP_DIR, "package.json")
    node_modules = os.path.join(MCP_DIR, "node_modules")
    if not os.path.exists(package_json):
        return False
    if os.path.exists(node_modules):
        return True

    npm = shutil.which("npm")
    if not npm:
        return False

    cmd = [npm, "ci"] if os.path.exists(os.path.join(MCP_DIR, "package-lock.json")) else [npm, "install"]
    try:
        proc = subprocess.Popen(cmd, cwd=MCP_DIR)
        proc.wait(timeout=300)
        return proc.returncode == 0
    except Exception:
        logging.exception("Failed to install MCP dependencies")
        return False


def start_mcp_bridge():
    global MCP_PROCESS, MCP_LOG_THREAD

    if os.environ.get("SMARTNOTES_DISABLE_MCP", "").lower() in ("1", "true", "yes"):
        logging.info("MCP bridge startup disabled by SMARTNOTES_DISABLE_MCP")
        return

    if MCP_PROCESS:
        return

    if not os.path.isdir(MCP_DIR):
        logging.warning("MCP directory not found: %s", MCP_DIR)
        return

    node = shutil.which("node")
    if not node:
        logging.warning("node was not found on PATH; MCP bridge skipped")
        return

    install_mcp_dependencies()

    index_js = os.path.join(MCP_DIR, "index.js")
    if os.path.exists(index_js):
        cmd = [node, "index.js"]
    else:
        npm = shutil.which("npm")
        if not npm:
            return
        cmd = [npm, "start"]

    try:
        MCP_PROCESS = subprocess.Popen(
            cmd,
            cwd=MCP_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1,
        )
        MCP_LOG_THREAD = threading.Thread(target=_mcp_stream_reader, args=(MCP_PROCESS.stdout,), daemon=True)
        MCP_LOG_THREAD.start()
    except Exception:
        logging.exception("Failed to start MCP bridge")
        MCP_PROCESS = None


def stop_mcp_bridge():
    global MCP_PROCESS
    if not MCP_PROCESS:
        return

    try:
        MCP_PROCESS.terminate()
        try:
            MCP_PROCESS.wait(timeout=5)
        except subprocess.TimeoutExpired:
            MCP_PROCESS.kill()
            MCP_PROCESS.wait(timeout=5)
    except Exception:
        logging.exception("Failed to stop MCP bridge")
    finally:
        MCP_PROCESS = None


# ----------------------- Ollama helpers -----------------------

def list_ollama_models():
    req = urllib.request.Request(f"{OLLAMA_BASE}/api/tags", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            return [m.get("name") for m in payload.get("models", []) if m.get("name")]
    except Exception:
        return []


def unload_model(model_name):
    payload = {
        "model": model_name,
        "prompt": "unload",
        "keep_alive": "0s",
        "stream": False,
    }
    req = urllib.request.Request(
        f"{OLLAMA_BASE}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
    )
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=20).read()
    except Exception:
        logging.exception("Failed to unload model: %s", model_name)


# ----------------------- Server lifecycle -----------------------

def start_control_server():
    global CONTROL_HTTPD, CONTROL_THREAD
    if CONTROL_HTTPD:
        return

    if os.environ.get("SMARTNOTES_DISABLE_CONTROL_API", "").lower() in ("1", "true", "yes"):
        logging.info("Control API startup disabled by SMARTNOTES_DISABLE_CONTROL_API")
        return

    try:
        CONTROL_HTTPD = ThreadedHTTPServer(("127.0.0.1", CONTROL_PORT), ControlRequestHandler)
        CONTROL_THREAD = threading.Thread(target=CONTROL_HTTPD.serve_forever, daemon=True)
        CONTROL_THREAD.start()
        logging.info("Control server listening on 127.0.0.1:%s", CONTROL_PORT)
    except OSError as exc:
        CONTROL_HTTPD = None
        CONTROL_THREAD = None
        logging.warning(
            "Control API could not bind to 127.0.0.1:%s (%s). Continuing without control API.",
            CONTROL_PORT,
            exc,
        )


def stop_control_server():
    global CONTROL_HTTPD
    if not CONTROL_HTTPD:
        return
    try:
        CONTROL_HTTPD.shutdown()
        CONTROL_HTTPD.server_close()
    finally:
        CONTROL_HTTPD = None


def start_server():
    global HTTPD, IS_RUNNING, SERVER_THREAD

    if IS_RUNNING:
        return

    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    HTTPD = ThreadedHTTPServer(("", APP_PORT), AppRequestHandler)
    SERVER_THREAD = threading.Thread(target=HTTPD.serve_forever, daemon=True)
    SERVER_THREAD.start()
    IS_RUNNING = True

    start_mcp_bridge()
    logging.info("App server started on http://localhost:%s", APP_PORT)


def stop_server():
    global HTTPD, IS_RUNNING
    if not IS_RUNNING:
        return

    stop_mcp_bridge()

    if HTTPD:
        HTTPD.shutdown()
        HTTPD.server_close()
        HTTPD = None

    IS_RUNNING = False
    logging.info("App server stopped")


def main():
    global APP_PORT

    parser = argparse.ArgumentParser(prog="server.py", description="Run SmartNotes server")
    parser.add_argument("--port", "-p", type=int, default=APP_PORT, help="Application HTTP port")
    parser.add_argument("--no-browser", action="store_true", help="Do not auto-open browser")
    parser.add_argument("--daemon", action="store_true", help="Run without opening browser and keep process attached")
    args = parser.parse_args()

    APP_PORT = args.port

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    start_control_server()
    start_server()

    if not args.no_browser and not args.daemon:
        try:
            webbrowser.open(f"http://localhost:{APP_PORT}")
        except Exception:
            logging.info("Could not open browser automatically")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        stop_server()
        stop_control_server()


if __name__ == "__main__":
    main()
