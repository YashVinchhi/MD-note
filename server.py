#!/usr/bin/env python3
"""
SmartNotes Advanced Server
Features:
- Concurrent request handling (Threaded)
- Interactive Numbered TUI
- Live Logs in separate window
"""

import http.server
import socketserver
import os
import threading
import time
import sys
import webbrowser
import logging
import argparse
import urllib.request
import urllib.error
import json

try:
    import pystray
    from PIL import Image, ImageDraw
except ImportError:
    pystray = None
    Image = None
    ImageDraw = None

# Add optional colored ASCII header support (pyfiglet + rich)
try:
    import pyfiglet
except Exception:
    pyfiglet = None

try:
    from rich.console import Console
    from rich.markup import escape as rich_escape
except Exception:
    Console = None
    rich_escape = None


PORT = 50001
CONTROL_PORT = 50002
SERVER_THREAD = None
HTTPD = None
IS_RUNNING = False
LOG_FILE = "server.log"
SELECTED_MODEL = "llama2:7b" # Default model
CONFIG_FILE = 'server_config.json'

# Setup Logging
logging.basicConfig(filename=LOG_FILE, level=logging.INFO, format='%(asctime)s - %(message)s', datefmt='%H:%M:%S')

def create_image():
    # Load favicon.ico for tray icon
    try:
        if Image is None:
            raise RuntimeError('PIL not available')
        return Image.open(os.path.join(os.path.dirname(__file__), 'favicon.ico'))
    except Exception as e:
        print(f"Failed to load favicon.ico: {e}. Using default icon.")
        # If PIL isn't available, return None and pystray will handle or skip
        if Image is None or ImageDraw is None:
            return None
        img = Image.new('RGB', (64, 64), color=(255, 255, 255))
        d = ImageDraw.Draw(img)
        d.ellipse((16, 16, 48, 48), fill=(59, 130, 246))
        return img

def tray_thread():
    if not pystray:
        print("pystray not installed. Tray icon will not be shown.")
        return
    icon = pystray.Icon("SmartNotesServer")
    icon.icon = create_image()
    icon.title = "SmartNotes Server"

    def on_start(icon, item):
        start_server()

    def on_restart(icon, item):
        stop_server()
        time.sleep(0.5)
        start_server()

    def on_logs(icon, item):
        open_logs()

    def on_browser(icon, item):
        webbrowser.open(f'http://localhost:{PORT}')

    def on_unload(icon, item):
        unload_model()

    def on_exit(icon, item):
        if IS_RUNNING:
            stop_server()
        icon.stop()
        os._exit(0)

    icon.menu = pystray.Menu(
        pystray.MenuItem('Start Server', on_start),
        pystray.MenuItem('Restart Server', on_restart),
        pystray.MenuItem('Live Log', on_logs),
        pystray.MenuItem('Open in Browser', on_browser),
        pystray.MenuItem('Unload Model', on_unload),
        pystray.MenuItem('Exit / Stop Server', on_exit)
    )
    icon.run()

def unload_model(model_name=None):
    """Unload a model from Ollama VRAM by calling /api/generate with keep_alive=0s."""
    try:
        name = model_name or SELECTED_MODEL
        url = "http://localhost:11434/api/generate"
        data = json.dumps({
            "model": name,
            "prompt": "unload",
            "keep_alive": "0s"
        }).encode()
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                print(f"✓ Unload request sent for model '{name}'. It should be removed from VRAM soon.")
                logging.info(f"Unload request sent for model '{name}' (keep_alive=0s)")
            else:
                print(f"Failed to send unload request for model '{name}'. Status: {response.status}")
    except Exception as e:
        print(f"Error unloading model: {e}")
        logging.error(f"Error unloading model: {e}")

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP Request Handler with CORS, Logging, and Ollama Proxy"""
    
    OLLAMA_HOST = "http://localhost:11434"

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()
    
    def log_message(self, format, *args):
        # Log to file instead of stderr
        msg = "%s - - [%s] %s" % (
            self.client_address[0],
            self.log_date_time_string(),
            format % args
        )
        logging.info(msg)

    def proxy_ollama(self, method):
        """Forward request to Ollama"""
        target_url = f"{self.OLLAMA_HOST}{self.path}"
        
        try:
            # Read body if POST
            data = None
            if method == 'POST':
                content_length = int(self.headers.get('Content-Length', 0))
                data = self.rfile.read(content_length)

            # Create Request
            req = urllib.request.Request(target_url, data=data, method=method)
            req.add_header('Content-Type', 'application/json')

            # Forward Request
            with urllib.request.urlopen(req) as response:
                self.send_response(response.status)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(response.read())
                
        except urllib.error.URLError as e:
            self.send_response(502)
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"Ollama Unreachable: {e}"}).encode())
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        if self.path == '/api/default-model':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"model": SELECTED_MODEL}).encode())
        elif self.path.startswith('/api/'):
            self.proxy_ollama('GET')
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            self.proxy_ollama('POST')
        else:
            self.send_error(404, "Endpoint not found")


class ThreadedHTTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

def get_ollama_models():
    """Fetch models from Ollama API"""
    try:
        url = "http://localhost:11434/api/tags"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read())
            return [m['name'] for m in data.get('models', [])]
    except Exception as e:
        print(f"Error fetching models: {e}")
        return []

def load_config():
    global SELECTED_MODEL
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            SELECTED_MODEL = cfg.get('selected_model', SELECTED_MODEL)
            logging.info(f"Loaded config: selected_model={SELECTED_MODEL}")
    except Exception as e:
        logging.warning(f"Failed to load config: {e}")

def save_config():
    try:
        cfg = {'selected_model': SELECTED_MODEL}
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(cfg, f)
        logging.info(f"Saved config: selected_model={SELECTED_MODEL}")
    except Exception as e:
        logging.error(f"Failed to save config: {e}")

def select_model_menu():
    global SELECTED_MODEL
    print("\n fetching models...", end="", flush=True)
    models = get_ollama_models()
    if not models:
        print(" Failed. Is Ollama running?")
        return

    print(" Done.\n")
    print("Available Models:")
    for i, model in enumerate(models):
        prefix = "-> " if model == SELECTED_MODEL else "   "
        print(f"{prefix}{i+1}. {model}")

    try:
        choice = input(f"\nSelect Model (1-{len(models)}): ")
        idx = int(choice) - 1
        if 0 <= idx < len(models):
            SELECTED_MODEL = models[idx]
            save_config()
            print(f"✓ Selected Model: {SELECTED_MODEL}")
            logging.info(f"Model changed to {SELECTED_MODEL}")
        else:
            print("Invalid selection.")
    except ValueError:
        print("Invalid input.")

def start_server():
    global HTTPD, IS_RUNNING, SERVER_THREAD
    
    if IS_RUNNING:
        print("⚠ Server is already running.")
        return

    try:
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        HTTPD = ThreadedHTTPServer(("", PORT), CORSRequestHandler)
        IS_RUNNING = True
        
        SERVER_THREAD = threading.Thread(target=HTTPD.serve_forever)
        SERVER_THREAD.daemon = True
        SERVER_THREAD.start()
        
        logging.info(f"Server started on port {PORT}")
        print(f"\n✓ Server started at http://localhost:{PORT}")
        
    except OSError as e:
        print(f"\n❌ Failed to start server: {e}")
        IS_RUNNING = False

def stop_server():
    global HTTPD, IS_RUNNING
    if not IS_RUNNING or not HTTPD:
        print("⚠ Server is not running.")
        return

    print("Stopping server...", end="", flush=True)
    HTTPD.shutdown()
    HTTPD.server_close()
    IS_RUNNING = False
    logging.info("Server stopped")
    print(" Done.")

def open_logs():
    """Open a new terminal window tailing the log file"""
    if os.name == 'nt': # Windows
        print("Opening logs in new window...")
        # PowerShell 'Get-Content -Wait' is equivalent to 'tail -f'
        os.system(f'start "SmartNotes Live Logs" powershell -NoExit -Command "Get-Content -Path {LOG_FILE} -Wait"')
    else:
        print("Log viewing is currently optimized for Windows PowerShell.")
        print(f"You can manually run: tail -f {LOG_FILE}")

def print_menu():
    status = "ACTIVE 🟢" if IS_RUNNING else "STOPPED 🔴"
    print(f"\n╔══════════════════════════════════════╗")
    print(f"║      SmartNotes Server Manager       ║")
    print(f"╠══════════════════════════════════════╣")
    print(f"║  Status: {status:<26} ║")
    print(f"║  Port:   {PORT:<27} ║")
    print(f"║  Model:  {SELECTED_MODEL:<27} ║")
    print(f"╠══════════════════════════════════════╣")
    print(f"║  1. Start Server                     ║")
    print(f"║  2. Stop Server                      ║")
    print(f"║  3. Restart Server                   ║")
    print(f"║  4. Live Logs (New Window)           ║")
    print(f"║  5. Open Browser                     ║")
    print(f"║  6. Clear Screen                     ║")
    print(f"║  7. Exit                             ║")
    print(f"║  8. Select AI Model                  ║")
    print(f"║  9. Unload Model from VRAM           ║")
    print(f"╚══════════════════════════════════════╝")

def start_control_server():
    """Start a small HTTP control server bound to localhost."""
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', CONTROL_PORT), ControlRequestHandler)
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        logging.info(f"Control API listening on 127.0.0.1:{CONTROL_PORT}")
        print(f"Control API available on 127.0.0.1:{CONTROL_PORT}")
        return server
    except OSError as e:
        logging.error(f"Failed to start control API: {e}")
        print(f"Failed to start control API: {e}")
        return None

class ControlRequestHandler(http.server.BaseHTTPRequestHandler):
    """Local-only control API for starting/stopping the server and changing settings.
    POST /control with JSON { action: 'start'|'stop'|'restart'|'status'|'open_logs'|'open_browser'|'list_models'|'select_model'|'unload_model', model: 'name' }
    """
    def _set_json_response(self, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()

    def do_GET(self):
        if self.client_address[0] not in ('127.0.0.1', '::1', 'localhost'):
            self._set_json_response(403)
            self.wfile.write(json.dumps({'error': 'Forbidden'}).encode())
            return
        if self.path == '/control/status':
            resp = {
                'is_running': IS_RUNNING,
                'port': PORT,
                'model': SELECTED_MODEL
            }
            self._set_json_response(200)
            self.wfile.write(json.dumps(resp).encode())
        else:
            self._set_json_response(404)
            self.wfile.write(json.dumps({'error': 'Not found'}).encode())

    def do_POST(self):
        if self.client_address[0] not in ('127.0.0.1', '::1', 'localhost'):
            self._set_json_response(403)
            self.wfile.write(json.dumps({'error': 'Forbidden'}).encode())
            return
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
        try:
            data = json.loads(body)
        except Exception:
            data = {}

        action = data.get('action')
        try:
            if action == 'start':
                start_server()
                self._set_json_response(200)
                self.wfile.write(json.dumps({'status': 'started'}).encode())
            elif action == 'stop':
                stop_server()
                self._set_json_response(200)
                self.wfile.write(json.dumps({'status': 'stopped'}).encode())
            elif action == 'restart':
                stop_server()
                time.sleep(0.3)
                start_server()
                self._set_json_response(200)
                self.wfile.write(json.dumps({'status': 'restarted'}).encode())
            elif action == 'open_logs':
                open_logs()
                self._set_json_response(200)
                self.wfile.write(json.dumps({'status': 'logs_opened'}).encode())
            elif action == 'open_browser':
                webbrowser.open(f'http://localhost:{PORT}')
                self._set_json_response(200)
                self.wfile.write(json.dumps({'status': 'browser_opened'}).encode())
            elif action == 'list_models':
                models = get_ollama_models()
                self._set_json_response(200)
                self.wfile.write(json.dumps({'models': models}).encode())
            elif action == 'select_model':
                model = data.get('model')
                if model:
                    global SELECTED_MODEL
                    SELECTED_MODEL = model
                    save_config()
                    logging.info(f"Model changed to {SELECTED_MODEL} via control API")
                    self._set_json_response(200)
                    self.wfile.write(json.dumps({'status': 'model_selected', 'model': SELECTED_MODEL}).encode())
                else:
                    self._set_json_response(400)
                    self.wfile.write(json.dumps({'error': 'model required'}).encode())
            elif action == 'unload_model':
                model = data.get('model')
                unload_model(model_name=model)
                self._set_json_response(200)
                self.wfile.write(json.dumps({'status': 'unload_requested'}).encode())
            else:
                self._set_json_response(400)
                self.wfile.write(json.dumps({'error': 'invalid action'}).encode())
        except Exception as e:
            self._set_json_response(500)
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def log_message(self, format, *args):
        # suppress default http logging
        logging.debug("Control API: %s" % (format % args))


def _hex_to_rgb(hex_color: str):
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def _interpolate_color(c1, c2, t: float):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def generate_gradient_hex(colors, steps):
    """Return a list of `steps` hex colors interpolated across the provided color stops."""
    if not colors or steps <= 0:
        return []
    # Convert to RGB
    rgbs = [_hex_to_rgb(c) for c in colors]
    result = []
    if len(rgbs) == 1:
        return [colors[0]] * steps
    segments = len(rgbs) - 1
    for i in range(steps):
        # position in [0,1]
        pos = i / max(steps - 1, 1)
        seg_f = pos * segments
        seg = int(min(segments - 1, seg_f))
        t = seg_f - seg
        c = _interpolate_color(rgbs[seg], rgbs[seg+1], t)
        result.append('#' + ''.join(f"{v:02X}" for v in c))
    return result


def print_colored_header(text='MD-NOTES'):
    """Print a neon-colored FIGlet header using rich if available, otherwise plain ASCII."""
    header_text = str(text or 'MD-NOTES')
    # Generate figlet ASCII
    if pyfiglet:
        try:
            fig = pyfiglet.figlet_format(header_text, font='doh')
        except Exception:
            try:
                fig = pyfiglet.figlet_format(header_text)
            except Exception:
                fig = header_text + "\n"
    else:
        fig = header_text + "\n"

    # If no rich, print plain
    if not Console:
        print(fig)
        return

    console = Console()
    # Neon palette
    palette = ['#39FF14', '#00FFD5', '#00B3FF', '#7A00FF', '#FF00D0']
    # Count characters excluding newlines for gradient distribution
    chars = [c for c in fig if c != '\n']
    if not chars:
        console.print(fig)
        return
    gradient = generate_gradient_hex(palette, len(chars))

    # Build markup string by mapping a color to each non-newline character
    out_parts = []
    idx = 0
    for ch in fig:
        if ch == '\n':
            out_parts.append('\n')
        else:
            color = gradient[idx]
            # Escape the character for rich markup
            esc = rich_escape(ch)
            out_parts.append(f"[{color}]{esc}[/]")
            idx += 1
    markup = ''.join(out_parts)
    try:
        console.print(markup)
    except Exception:
        # fallback to plain print
        print(fig)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--daemon', action='store_true', help='Run server without interactive menu')
    args = parser.parse_args()

    # Ensure log file exists
    if not os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'w') as f: f.write(f"Server Log Initialized\n")

    # Load persisted config (if any)
    load_config()

    # Print neon header on startup (optional)
    try:
        print_colored_header('MD-NOTES')
    except Exception:
        pass

    # Start tray icon in a separate thread
    if pystray:
        t = threading.Thread(target=tray_thread, daemon=True)
        t.start()
    else:
        print("pystray not installed. No tray icon will be shown.")

    # Start control API so the CLI can control the server
    control_server = start_control_server()

    # Auto-start
    start_server()

    if args.daemon:
        # Run in daemon mode (no interactive menu)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print('\nShutting down...')
            if IS_RUNNING:
                stop_server()
            if control_server:
                control_server.shutdown()
            sys.exit(0)

    # Interactive loop (unchanged behavior)
    while True:
        try:
            print_menu()
            choice = input("\nSelect option [1-9]: ").strip()

            if choice == '1':
                start_server()
            elif choice == '2':
                stop_server()
            elif choice == '3':
                stop_server()
                time.sleep(0.5)
                start_server()
            elif choice == '4':
                open_logs()
            elif choice == '5':
                webbrowser.open(f'http://localhost:{PORT}')
            elif choice == '6':
                os.system('cls' if os.name == 'nt' else 'clear')
            elif choice == '7':
                if IS_RUNNING:
                    stop_server()
                print("Goodbye!")
                if control_server:
                    control_server.shutdown()
                sys.exit(0)
            elif choice == '8':
                select_model_menu()
            elif choice == '9':
                unload_model()
            else:
                print("Invalid option. Please try again.")
                time.sleep(1)

        except KeyboardInterrupt:
            print("\nType '7' to exit.")
        except Exception as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    main()
