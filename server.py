#!/usr/bin/env python3
"""
SmartNotes Development Server
Simple HTTP server with CORS support for local development
"""

import http.server
import socketserver
import os

PORT = 8000

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP Request Handler with CORS headers"""
    
    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()
    
    def do_OPTIONS(self):
        """Handle preflight requests"""
        self.send_response(200)
        self.end_headers()

def main():
    """Start the development server"""
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with socketserver.TCPServer(("", PORT), CORSRequestHandler) as httpd:
        print(f"╔═══════════════════════════════════════════════╗")
        print(f"║   SmartNotes Development Server               ║")
        print(f"╠═══════════════════════════════════════════════╣")
        print(f"║   Server running at:                          ║")
        print(f"║   → http://localhost:{PORT}                   ║")
        print(f"║                                               ║")
        print(f"║   Press Ctrl+C to stop the server             ║")
        print(f"╚═══════════════════════════════════════════════╝")
        print()
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n✓ Server stopped")

if __name__ == "__main__":
    main()
