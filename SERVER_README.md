# SmartNotes - Local Development Server

This simple server script resolves CORS issues when testing locally.

## Quick Start

Run this command in the `d:\Code\Notes\temp` directory:

```bash
python server.py
```

Then open: http://localhost:8000

## Why do we need this?

When opening HTML files directly (file:// protocol), browsers block:
- CORS requests to localhost (Ollama AI won't work)
- Some JavaScript features
- Service workers

A local server fixes all these issues!
