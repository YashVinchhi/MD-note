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

# Setup Logging
logging.basicConfig(filename=LOG_FILE, level=logging.INFO, format='%(asctime)s - %(message)s', datefmt='%H:%M:%S')

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP Request Handler with CORS headers and File Logging"""
    
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
        # Log to file instead of stderr to keep TUI clean
        msg = "%s - - [%s] %s" % (
            self.client_address[0],
            self.log_date_time_string(),
            format % args
        )
        logging.info(msg)

class ThreadedHTTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

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
    print(f"║  Status: {status:<27} ║")
    print(f"║  Port:   {PORT:<27} ║")
    print(f"╠══════════════════════════════════════╣")
    print(f"║  1. Start Server                     ║")
    print(f"║  2. Stop Server                      ║")
    print(f"║  3. Restart Server                   ║")
    print(f"║  4. Live Logs (New Window)           ║")
    print(f"║  5. Open Browser                     ║")
    print(f"║  6. Clear Screen                     ║")
    print(f"║  7. Exit                             ║")
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
            else:
                print("Invalid option. Please try again.")
                time.sleep(1)
                
        except KeyboardInterrupt:
            print("\nType '7' to exit.")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    main()
