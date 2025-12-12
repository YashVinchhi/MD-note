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

PORT = 8000
SERVER_THREAD = None
HTTPD = None
IS_RUNNING = False
LOG_FILE = "server.log"
SELECTED_MODEL = "llama2:7b" # Default model

# Setup Logging
logging.basicConfig(filename=LOG_FILE, level=logging.INFO, format='%(asctime)s - %(message)s', datefmt='%H:%M:%S')

import urllib.request
import urllib.error
import json

# ... (Logging setup remains)

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

def select_model_menu():
    global SELECTED_MODEL
    print("\\nfetching models...", end="", flush=True)
    models = get_ollama_models()
    if not models:
        print(" Failed. Is Ollama running?")
        return

    print(" Done.\\n")
    print("Available Models:")
    for i, model in enumerate(models):
        prefix = "-> " if model == SELECTED_MODEL else "   "
        print(f"{prefix}{i+1}. {model}")

    try:
        choice = input(f"\\nSelect Model (1-{len(models)}): ")
        idx = int(choice) - 1
        if 0 <= idx < len(models):
            SELECTED_MODEL = models[idx]
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
    print(f"╚══════════════════════════════════════╝")

def main():
    # Ensure log file exists
    if not os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'w') as f: f.write(f"Server Log Initialized\n")

    # Auto-start
    start_server()
    
    while True:
        try:
            print_menu()
            choice = input("\nSelect option [1-7]: ").strip()
            
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
                sys.exit(0)
            elif choice == '8':
                select_model_menu()
            else:
                print("Invalid option. Please try again.")
                time.sleep(1)
                
        except KeyboardInterrupt:
            print("\nType '7' to exit.")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    main()
