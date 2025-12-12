# SmartNotes Local 🧠✨

A powerful, local-first note-taking application with AI superpowers. Built for speed, privacy, and extensibility.

![Demo](demo_placeholder.png)

## 🚀 Key Features

### 🤖 AI Integration (RAG)
*   **Chat with your Notes**: Ask questions and get answers based on your personal knowledge base using embedded local AI (Ollama).
*   **Semantic Search**: Find notes by meaning, not just keywords.
*   **Auto-Tagging**: (Coming Soon) AI-suggested organization.

### 📝 Rich Editing
*   **Markdown Support**: Full CommonMark syntax.
*   **Math Support**: Render LaTeX equations (e.g., $E=mc^2$) using KaTeX.
*   **Diagrams**: Create flowcharts and graphs with Mermaid.js.
*   **Drag & Drop**: Easily attach images and files.

### 📂 Advanced Organization
*   **Folders**: Structure your notes hierarchically.
*   **Nested Tags**: Use `#project/feature` style tagging.
*   **Smart Views**: Dynamic filters for your workflow.

### 🛡️ Privacy & Reliability
*   **Local-First**: All data stored locally in your browser (IndexedDB).
*   **Import/Export**: Full JSON backup and restore capabilities.
*   **Offline Ready**: Works without an internet connection.

## 🛠️ Tech Stack

*   **Frontend**: Vanilla JS (ES6+), HTML5, CSS3
*   **Storage**: Dexie.js (IndexedDB wrapper)
*   **Styling**: Custom CSS & Tailwind (via CDN)
*   **AI**: Ollama (Local LLM)
*   **Server**: Python `ThreadingHTTPServer` (Zero dependencies)

## ⚡ Getting Started

### Prerequisites
1.  **Python 3.x** installed.
2.  **Ollama** installed (for AI features) with a model (e.g., `llama3` or `mistral`) pulled.

### Installation
1.  Clone the repository.
2.  Navigate to the project directory:
    ```bash
    cd smartnotes
    ```

### Running the App
Start the development server:
```bash
python server.py
```

Click the link shown in the terminal (usually `http://localhost:8000`).

## 🖥️ Server Commands (TUI)
The `server.py` script includes a built-in Terminal UI for easy management:

*   **1. Start server**: Launches the threaded server.
*   **2. Stop server**: halts the server.
*   **3. Restart server**: Quick reboot.
*   **4. Live Logs**: Opens a **new window** showing real-time traffic logs.
*   **5. Open Browser**: Launches the app in your default browser.

Type the number of the option and press Enter.

## 🤝 Contributing
1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## 📄 License
Distributed under the MIT License. See `LICENSE` for more information.
