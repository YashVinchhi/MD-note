/**
 * AI Tool Manager - Enables the AI to interact with the App
 */
const AITools = {
    definitions: [
        {
            name: "create_note",
            description: "Create a new note with the given title and content.",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string", description: "The title of the note" },
                    content: { type: "string", description: "The markdown content of the note" },
                    tags: { type: "array", items: { type: "string" }, description: "Optional list of tags" }
                },
                required: ["title", "content"]
            }
        },
        {
            name: "update_note",
            description: "Append content to an existing note or overwrite it.",
            parameters: {
                type: "object",
                properties: {
                    id: { type: "string", description: "The ID of the note to update (use search or get_active_note first to find ID)" },
                    content: { type: "string", description: "The text to add or replace" },
                    mode: { type: "string", enum: ["append", "overwrite"], description: "Defaults to 'append'" }
                },
                required: ["id", "content"]
            }
        },
        {
            name: "find_note_by_title",
            description: "Find a note ID by its title (exact or partial match). Use this when the user refers to a note by name.",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string" }
                },
                required: ["title"]
            }
        },
        {
            name: "search_notes",
            description: "Search for notes by query string (searches title and content).",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string" }
                },
                required: ["query"]
            }
        },
        {
            name: "get_active_note",
            description: "Get the content and metadata of the currently open note.",
            parameters: {
                type: "object",
                properties: {},
            }
        },
        {
            name: "read_note",
            description: "Get the full content of a specific note by ID.",
            parameters: {
                type: "object",
                properties: {
                    id: { type: "string" }
                },
                required: ["id"]
            }
        },
        {
            name: "list_folders",
            description: "Get a list of all folders.",
            parameters: { type: "object", properties: {} }
        }
    ],

    /**
     * implementations
     */
    async create_note({ title, content, tags }) {
        const newNote = {
            id: Date.now().toString(),
            title: title || "Untitled",
            body: content || "",
            tags: tags || [],
            date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            pinned: false,
            updatedAt: Date.now(),
            wikiLinks: []
        };
        await NoteDAO.save(newNote);

        if (typeof window !== 'undefined') {
            if (window.notes) window.notes.unshift(newNote);
            if (window.renderNoteList) window.renderNoteList();
        }
        return `Note created successfully. ID: ${newNote.id}`;
    },

    async update_note({ id, content, mode }) {
        const note = await NoteDAO.get(id);
        if (!note) return `Error: Note with ID "${id}" not found. If you are trying to use a Title, please use 'find_note_by_title' first to get the ID.`;

        if (mode === 'overwrite') {
            note.body = content;
        } else {
            note.body = (note.body || '') + '\n' + content;
        }
        note.updatedAt = Date.now();
        await NoteDAO.save(note);

        if (typeof window !== 'undefined' && window.activeNoteId === id) {
            if (document.getElementById('note-body')) {
                document.getElementById('note-body').value = note.body;
                document.getElementById('note-body').dispatchEvent(new Event('input'));
            }
        }
        return `Note updated successfully.`;
    },

    async find_note_by_title({ title }) {
        const all = await NoteDAO.getAll();
        const exact = all.find(n => n.title.toLowerCase() === title.toLowerCase());
        if (exact) return exact.id;

        const partial = all.find(n => n.title.toLowerCase().includes(title.toLowerCase()));
        if (partial) return partial.id;

        return "Note not found";
    },

    async search_notes({ query }) {
        const results = await NoteDAO.search(query);
        return JSON.stringify(results.map(n => ({ id: n.id, title: n.title, preview: n.body.slice(0, 100) })));
    },

    async get_active_note() {
        if (typeof window !== 'undefined' && window.activeNoteId) {
            const note = window.notes.find(n => n.id === window.activeNoteId);
            if (note) return JSON.stringify(note);
        }
        return "No note is currently active.";
    },

    async read_note({ id }) {
        const note = await NoteDAO.get(id);
        if (note) return JSON.stringify(note);
        return "Note not found.";
    },

    async list_folders() {
        const folders = await FolderDAO.getAll();
        return JSON.stringify(folders.map(f => ({ id: f.id, name: f.name })));
    },

    // --- Helpers for ChatManager ---

    getSystemPromptAddon() {
        return `
## AVAILABLE TOOLS
You can use tools to perform actions. To call a tool, you MUST respond with a JSON object in the following format ONLY (no other text).

{
  "tool": "tool_name",
  "arguments": { ... }
}

Available Tools:
${this.definitions.map(d => `- ${d.name}: ${d.description} (Args: ${Object.keys(d.parameters.properties).join(', ')})`).join('\n')}

IMPORTANT:
- If the user refers to a note by name (e.g. "Update Shopping List"), you MUST find its ID first using 'find_note_by_title' or 'search_notes'.
- Never use a note's title as the 'id' argument.
- If you create a note, the ID is returned in the result.

Example:
{ "tool": "find_note_by_title", "arguments": { "title": "Shopping List" } }
`;
    },

    async execute(name, args) {
        if (this[name]) {
            try {
                console.log(`Executing tool: ${name}`, args);
                return await this[name](args);
            } catch (e) {
                return `Error execution tool ${name}: ${e.message}`;
            }
        }
        return `Error: Tool ${name} not found.`;
    }
};

window.AITools = AITools;
