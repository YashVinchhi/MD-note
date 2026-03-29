// === AI-Assisted Diagram Generation ===
// Handler for AI Diagram button (used for both injected and static button)
async function handleAIDiagramButtonClick(evt) {
    const btn = evt.currentTarget;
    // Try to find the main note textarea (id note-body)
    const textarea = document.getElementById('note-body') || document.querySelector('textarea');
    if (!textarea) return alert('No note editor found.');
    const selStart = textarea.selectionStart, selEnd = textarea.selectionEnd;
    const selected = textarea.value.substring(selStart, selEnd).trim();
    if (!selected) return alert('Select some text to generate a diagram.');
    btn.disabled = true;
    btn.textContent = 'Generating...';
    try {
        // Use AIService to generate diagram from text (default: Mermaid)
        const diagram = await window.AIService.generateDiagramFromText(selected, 'mermaid');
        if (!diagram) throw new Error('No diagram generated.');
        // Insert as Mermaid code block at selection
        const before = textarea.value.substring(0, selStart);
        const after = textarea.value.substring(selEnd);
        const insert = diagram.startsWith('<svg')
            ? `\n\n${diagram}\n\n`
            : `\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\n`;
        textarea.value = before + insert + after;
        // Move cursor after inserted block
        textarea.selectionStart = textarea.selectionEnd = before.length + insert.length;
        textarea.dispatchEvent(new Event('input'));
    } catch (e) {
        alert('Diagram generation failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'AI Diagram';
    }
}

// Attach handler to static button if present
function wireAIDiagramButton() {
    const btn = document.getElementById('ai-diagram-btn');
    if (btn && !btn._aiWired) {
        btn.addEventListener('click', handleAIDiagramButtonClick);
        btn._aiWired = true;
    }
}

// Dummy AI diagram generator (replace with real AI call)
async function generateDiagramFromText(text) {
    // For demo: if text contains 'flow', return a flowchart; if 'mind', return a mindmap; else sequence
    if (/mind ?map/i.test(text)) {
        return `mindmap\n  Root\n    Subtopic1\n      Detail1\n    Subtopic2`;
    } else if (/flow/i.test(text)) {
        return `flowchart TD\n  A[Start] --> B{Decision}\n  B -- Yes --> C[End]\n  B -- No --> D[Retry]`;
    } else {
        return `sequenceDiagram\n  Alice->>Bob: Hello Bob, how are you?\n  Bob-->>Alice: I am good thanks!`;
    }
    // In production, call your AI backend here
}

// Call on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAIDiagramButton);
} else {
    wireAIDiagramButton();
}

// (Removed duplicate generateDiagramFromText and addAIDiagramButton)
// Only wire up the AI Diagram button once, and do not override other toolbar events
// --- Chart Editor Modal (Stub) ---
function openChartEditor(type, specText, targetId) {
    alert('Chart editing coming soon!\n\nType: ' + type + '\nTarget: ' + targetId + '\nSpec:\n' + specText);
    // Future: Open modal with JSON editor, CSV/JSON import, live preview, and save to note
}
// --- AI Folder Suggestion ---
async function triggerAIFolderSuggest() {
    if (!activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;

    // Gather content and tags
    const content = (note.title || '') + '\n' + (note.body || '');
    // Get all folder names
    const allFolders = (await FolderDAO.getAll()).map(f => f.name);

    // Show loading state
    const btn = document.getElementById('ai-folder-btn');
    if (btn) btn.classList.add('animate-pulse');

    try {
        const suggestion = await AIService.generateFolderSuggestion(content, note.tags, allFolders);
        if (suggestion) {
            // Show suggestion in UI (dropdown or toast)
            showFolderSuggestion(suggestion);
        } else {
            showToast('No folder suggestion found.', true);
        }
    } catch (e) {
        showToast('AI Folder Suggestion failed.', true);
    } finally {
        if (btn) btn.classList.remove('animate-pulse');
    }
}

function showFolderSuggestion(suggestion) {
    // Show Accept/Ignore toast
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toast-message');
    if (!toast || !msg) return;
        msg.innerHTML = `AI suggests folder: <b>${escapeHtml(suggestion)}</b> <button id='accept-ai-folder' class='ml-2 px-2 py-0.5 rounded bg-emerald-500 text-white text-xs'>Accept</button> <button id='ignore-ai-folder' class='ml-1 px-2 py-0.5 rounded bg-gray-300 text-gray-700 text-xs'>Ignore</button>`;
    toast.classList.remove('opacity-0', 'translate-y-10');
    toast.classList.add('opacity-100', '-translate-y-2');
    setTimeout(() => {
        toast.classList.remove('opacity-100', '-translate-y-2');
        toast.classList.add('opacity-0', 'translate-y-10');
    }, 8000);

    // Accept handler
    setTimeout(() => {
        const acceptBtn = document.getElementById('accept-ai-folder');
        const ignoreBtn = document.getElementById('ignore-ai-folder');
        if (acceptBtn) {
            acceptBtn.onclick = async () => {
                await acceptAIFolderSuggestion(suggestion);
                toast.classList.remove('opacity-100', '-translate-y-2');
                toast.classList.add('opacity-0', 'translate-y-10');
            };
        }
        if (ignoreBtn) {
            ignoreBtn.onclick = () => {
                toast.classList.remove('opacity-100', '-translate-y-2');
                toast.classList.add('opacity-0', 'translate-y-10');
            };
        }
    }, 100);
}

async function acceptAIFolderSuggestion(suggestion) {
    // Find or create folder, assign to note
    const allFolders = await FolderDAO.getAll();
    let folder = allFolders.find(f => f.name === suggestion);
    if (!folder) {
        folder = await FolderDAO.create(suggestion);
        await refreshFolders();
    }
    // Assign to current note
    if (!activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;
    note.folderId = folder.id;
    await NoteDAO.save(note);
    // Update folder select UI
    const select = document.getElementById('note-folder-select');
    if (select) select.value = folder.id;
    showToast(`Folder set to: ${suggestion}`);
}
// --- Import/Export All Notes ---
window.exportAllNotes = async function () {
    try {
        const allNotes = await NoteDAO.getAll();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allNotes, null, 2));
        const dlAnchor = document.createElement('a');
        dlAnchor.setAttribute("href", dataStr);
        dlAnchor.setAttribute("download", "notes-export.json");
        document.body.appendChild(dlAnchor);
        dlAnchor.click();
        dlAnchor.remove();
        showToast('All notes exported!');
    } catch (err) {
        showToast('Export failed: ' + err.message, true);
    }
}

window.importAllNotes = async function () {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const importedNotes = JSON.parse(text);
            if (!Array.isArray(importedNotes)) throw new Error('Invalid format');
            for (const note of importedNotes) {
                // Optionally, check for required fields
                if (note.id && note.title) {
                    await NoteDAO.save(note);
                }
            }
            await refreshNotes();
            showToast('Notes imported!');
        } catch (err) {
            showToast('Import failed: ' + err.message, true);
        }
    };
    input.click();
}
/**
 * Synapse Application Logic
 * Integrates: Dexie DB, UI Rendering, Event Handling
 */

// State
let notes = []; // Local cache of notes for rendering
let activeNoteId = null;
let isPreviewMode = false;
const notesReliability = window.FileSyncService || null;

// --- Core Functions ---
// Load all notes from DB and render
async function refreshNotes(filter = 'all', searchQuery = '') {
    try {
        if (searchQuery) {
            // Check for Semantic Search Toggle
            const isSemantic = document.getElementById('semantic-search-toggle')?.checked;
            if (isSemantic && window.VectorStore) {
                // RAG Search
                const results = await VectorStore.search(searchQuery, 10);
                const ids = results.map(r => r.noteId);
                // Preserve order of relevance
                notes = await Promise.all(ids.map(id => NoteDAO.get(id)));
                notes = notes.filter(n => n); // Remove nulls
            } else {
                notes = await NoteDAO.search(searchQuery);
            }
        } else {
            notes = await NoteDAO.getAll();
        }
        renderNoteList(filter, searchQuery);
    } catch (err) {
        console.error('Failed to refresh notes:', err);
    }
}

// --- WikiLink Parsing ---
function extractWikiLinks(content) {
    const regex = /\[\[([^\]]+)\]\]/g;
    const links = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        links.push(match[1]);
    }
    return links;
}

async function saveCurrentNote() {
    if (!activeNoteId) return;

    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;

    // Extract WikiLinks
    note.wikiLinks = extractWikiLinks(note.body || '');

    try {
        await NoteDAO.save(note);
        updateSyncStatus();
        if (notesReliability) notesReliability.queueFilesystemSync();
        // We don't do full refresh here to avoid UI jitter, just update list item if needed
        renderNoteList();

        // Refresh Graph if active
        if (document.getElementById('graph-container') && !document.getElementById('graph-container').classList.contains('hidden')) {
            if (window.renderGraph) renderGraph('graph-container');
        }

        // Auto-Index for Vector Search (Debounced? app.js save is already debounced)
        if (window.VectorStore) {
            // Index the note first
            await VectorStore.indexNote(note);

            // Auto-link: Find similar notes and update aiLinks
            await autoLinkNote(note);
        }

    } catch (err) {
        console.error('Save failed:', err);
    }
}

// Auto-link note to similar notes using semantic search
async function autoLinkNote(note) {
    if (!window.VectorStore || !note.body || note.body.trim().length < 20) return;

    try {
        // Search for similar notes
        const results = await VectorStore.search(note.title + ' ' + note.body.substring(0, 200), 5);

        // Filter out self and get unique note IDs
        const similarNoteIds = results
            .filter(r => r.noteId !== note.id && r.score > 0.3) // Similarity threshold
            .map(r => r.noteId);

        if (similarNoteIds.length > 0) {
            // Update the note's aiLinks
            note.aiLinks = [...new Set([...(note.aiLinks || []), ...similarNoteIds])].slice(0, 5); // Max 5 links
            await NoteDAO.save(note);
            console.log(`Auto-linked note "${note.title}" to ${similarNoteIds.length} similar notes`);
        }
    } catch (err) {
        console.error('Auto-link failed:', err);
    }
}

async function createNewNote(title = "Untitled Note") {
    const newNote = {
        id: Date.now().toString(),
        title: title,
        body: "",
        tags: [],
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        pinned: false,
        updatedAt: Date.now(),
        wikiLinks: []
    };

    try {
        await NoteDAO.save(newNote);
        notes.unshift(newNote); // Update local cache immediately
        activeNoteId = newNote.id;

        loadNoteIntoEditor(newNote);
        renderNoteList();

        // Auto-focus title
        setTimeout(() => document.getElementById('note-title').focus(), 100);

        // Open in Tab
        TabManager.open(newNote.id);

    } catch (err) {
        console.error('Create failed:', err);
    }
}


async function deleteCurrentNote() {
    if (!activeNoteId) return;
    if (confirm('Are you sure you want to delete this note?')) {
        try {
            await NoteDAO.delete(activeNoteId);
            notes = notes.filter(n => n.id !== activeNoteId);

            // Activate next note or clear
            activeNoteId = notes.length > 0 ? notes[0].id : null;

            if (activeNoteId) {
                loadNoteIntoEditor(notes.find(n => n.id === activeNoteId));
            } else {
                clearEditor();
            }
            renderNoteList();
        } catch (err) {
            console.error('Delete failed:', err);
        }
    }
}

async function togglePin() {
    if (!activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;

    note.pinned = !note.pinned;
    await saveCurrentNote();
    renderNoteList(); // Re-sorts list
    updatePinButtonState(note.pinned);
}

// --- Rendering ---

function renderNoteList(filter = 'all', searchQuery = '') {
    const container = document.getElementById('notes-container');
    const searchVal = (searchQuery || document.getElementById('search-input').value || '').toLowerCase();
    const currentFolder = typeof activeFolderId !== 'undefined' ? activeFolderId : null;

    if (!window.NoteListService) {
        document.getElementById('total-count').innerText = notes.length;
        return;
    }

    const filteredNotes = window.NoteListService.filterNotes(notes, {
        filter,
        searchQuery: searchVal,
        activeFolderId: currentFolder,
        includeTagsInSearch: true
    });

    document.getElementById('total-count').innerText = filteredNotes.length;
    container.innerHTML = window.NoteListService.renderNoteListHtml(filteredNotes, {
        activeNoteId,
        nestedTagRendering: true
    });
}

// Graph View Toggle
function toggleGraphView() {
    const listContainer = document.getElementById('notes-list-wrapper'); // We need to wrap the list
    const graphContainer = document.getElementById('graph-container');
    const graphBtn = document.getElementById('graph-view-btn');

    // Check current state (heuristic: is graph hidden?)
    const isGraphHidden = graphContainer.classList.contains('hidden');

    if (isGraphHidden) {
        // Show Graph
        listContainer.classList.add('hidden');
        graphContainer.classList.remove('hidden');
        graphBtn.classList.add('bg-blue-50', 'dark:bg-blue-900/20', 'text-blue-600', 'dark:text-blue-400');
        renderGraph('graph-container');
    } else {
        // Show List
        listContainer.classList.remove('hidden');
        graphContainer.classList.add('hidden');
        graphBtn.classList.remove('bg-blue-50', 'dark:bg-blue-900/20', 'text-blue-600', 'dark:text-blue-400');
    }
}

function setActiveNote(id) {
    // Instead of loading directly, we route through TabManager
    TabManager.open(id);
}

// NOTE: loadNoteIntoEditor is called by TabManager.switch()

function loadNoteIntoEditor(note) {
    if (!note) return clearEditor();

    document.getElementById('note-title').value = note.title;
    document.getElementById('note-body').value = note.body;
    document.getElementById('note-date').innerText = note.date;
    document.getElementById('header-title').innerText = note.title || 'Untitled';

    updateTagsUI(note.tags || []);
    updatePinButtonState(note.pinned);

    // Auto resize title
    const titleArea = document.getElementById('note-title');
    titleArea.style.height = 'auto';
    titleArea.style.height = titleArea.scrollHeight + 'px';

    // Handle preview mode if active
    if (isPreviewMode) renderMarkdownPreview();
}

function clearEditor() {
    document.getElementById('note-title').value = '';
    document.getElementById('note-body').value = '';
    document.getElementById('header-title').innerText = 'Select a note';
    document.getElementById('tags-container').innerHTML = '';
}

function updateTagsUI(tags) {
    const container = document.getElementById('tags-container');
    container.innerHTML = tags.map(tag => `
        <span onclick="removeTag('${tag}')" class="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full text-xs font-medium border border-blue-200 dark:border-blue-800 flex items-center gap-1 group cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30 hover:border-red-200 transition-colors">
            ${tag}
            <span class="material-symbols-outlined text-[12px] opacity-0 group-hover:opacity-100">close</span>
        </span>
    `).join('');
}

function updatePinButtonState(isPinned) {
    const btn = document.getElementById('pin-btn');
    if (isPinned) {
        btn.classList.add('text-blue-500', 'bg-blue-50', 'dark:bg-blue-900/20');
        btn.classList.remove('text-gray-400');
    } else {
        btn.classList.remove('text-blue-500', 'bg-blue-50', 'dark:bg-blue-900/20');
        btn.classList.add('text-gray-400');
    }
}

// --- Event Listeners ---

// Auto-save debouncing
let saveTimeout;
const handleInput = (e) => {
    if (!activeNoteId) {
        createNewNote(e.target.value); // Create on first char if no note active
        return;
    }

    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;

    if (e.target.id === 'note-title') {
        note.title = e.target.value;
        document.getElementById('header-title').innerText = note.title;
        TabManager.updateTitle(activeNoteId, note.title); // Update Tab
        // Resize textarea
        e.target.style.height = 'auto';
        e.target.style.height = e.target.scrollHeight + 'px';
    } else if (e.target.id === 'note-body') {
        note.body = e.target.value;
        // Live Preview in Split Mode
        if (isSplitMode) {
            renderMarkdownPreview();
        }
    }

    note.updatedAt = Date.now();

    // Debounce save
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveCurrentNote, 1000);
};

document.getElementById('note-title').addEventListener('input', handleInput);
document.getElementById('note-body').addEventListener('input', handleInput);

// Search
document.getElementById('search-input').addEventListener('input', (e) => {
    refreshNotes('all', e.target.value);
});

// Tag Input
document.getElementById('tag-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && activeNoteId) {
        const tag = e.target.value.trim();
        if (tag) {
            const note = notes.find(n => n.id === activeNoteId);
            if (!note.tags.includes(tag)) {
                note.tags.push(tag);
                saveCurrentNote();
                updateTagsUI(note.tags);
            }
            e.target.value = '';
        }
    }
});

window.removeTag = (tag) => {
    if (!activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    note.tags = note.tags.filter(t => t !== tag);
    saveCurrentNote();
    updateTagsUI(note.tags);
};

// Omnibar
document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        const bar = document.getElementById('omnibar');
        bar.classList.toggle('active');
        if (bar.classList.contains('active')) document.getElementById('omnibar-input').focus();
    } else if (e.key === 'Escape') {
        document.getElementById('omnibar').classList.remove('active');
    }
});

document.getElementById('omnibar-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        createNewNote(e.target.value);
        e.target.value = '';
        document.getElementById('omnibar').classList.remove('active');
    }
});

// UI Toggles
// UI Toggles
let isSplitMode = false;

window.togglePane = (pane) => {
    const nav = document.getElementById('navigation-pane');
    const list = document.getElementById('note-list-pane');

    if (pane === 'nav') {
        nav.classList.toggle('active');
        if (window.innerWidth < 1024 && nav.classList.contains('active')) list.classList.remove('active');
    } else if (pane === 'list') {
        list.classList.toggle('active');
        if (window.innerWidth < 1024 && list.classList.contains('active')) nav.classList.remove('active');
    }
};

window.toggleSplitMode = async () => {
    isSplitMode = !isSplitMode;
    const wrapper = document.getElementById('content-wrapper');
    const editor = document.getElementById('note-body');
    const preview = document.getElementById('note-preview');
    const container = document.getElementById('editor-container'); // Only used for width constraint
    const btn = document.getElementById('split-btn');
    const syncBtn = document.getElementById('scroll-sync-btn');

    if (isSplitMode) {
        // Force out of standard preview mode if active
        if (isPreviewMode) {
            await window.togglePreviewMode();
            isSplitMode = true; // Reset
        }

        // Show both
        editor.classList.remove('hidden');
        preview.classList.remove('hidden');

        // Allow container to expand
        container.classList.remove('max-w-3xl');
        container.classList.add('max-w-none');

        // 1. Flex the Wrapper
        wrapper.classList.add('flex', 'gap-6');

        // 2. Size the Editor
        editor.classList.remove('w-full');
        editor.classList.add('w-1/2', 'pr-4', 'border-r', 'border-gray-200', 'dark:border-gray-800', 'overflow-y-auto');

        // 3. Size the Preview
        preview.classList.add('w-1/2', 'pl-4', 'overflow-y-auto');
        preview.style.maxWidth = '100%';

        // Render
        await renderMarkdownPreview();

        // Show Scroll Sync button
        syncBtn.classList.remove('hidden');
        syncBtn.classList.add('flex');

        // UI Feedback
        btn.classList.add('text-blue-500', 'bg-blue-50', 'dark:bg-blue-900/20');
        btn.querySelector('span:not(.material-symbols-outlined)').innerText = 'Split On';

        // Setup scroll sync listeners
        setupScrollSync();
    } else {
        // Revert Container
        container.classList.remove('max-w-none');
        container.classList.add('max-w-3xl');

        // Un-Flex Wrapper
        wrapper.classList.remove('flex', 'gap-6');

        // Reset Editor
        editor.classList.add('w-full');
        editor.classList.remove('w-1/2', 'pr-4', 'border-r', 'border-gray-200', 'dark:border-gray-800', 'overflow-y-auto');

        // Reset Preview
        preview.classList.remove('w-1/2', 'pl-4', 'overflow-y-auto');
        preview.classList.add('hidden');
        preview.style.maxWidth = '';

        // Hide Scroll Sync button
        syncBtn.classList.add('hidden');
        syncBtn.classList.remove('flex', 'text-green-500', 'bg-green-50', 'dark:bg-green-900/20');

        // Disable scroll sync
        isScrollSyncEnabled = false;
        removeScrollSync();

        // UI Feedback
        btn.classList.remove('text-blue-500', 'bg-blue-50', 'dark:bg-blue-900/20');
        btn.querySelector('span:not(.material-symbols-outlined)').innerText = 'Split';
    }
};

// --- Scroll Sync ---
let isScrollSyncEnabled = false;
let scrollSyncHandler = null;

function setupScrollSync() {
    const editor = document.getElementById('note-body');
    const preview = document.getElementById('note-preview');

    scrollSyncHandler = (source) => {
        if (!isScrollSyncEnabled || !isSplitMode) return;

        const sourceEl = source === 'editor' ? editor : preview;
        const targetEl = source === 'editor' ? preview : editor;

        const scrollPercentage = sourceEl.scrollTop / (sourceEl.scrollHeight - sourceEl.clientHeight);
        targetEl.scrollTop = scrollPercentage * (targetEl.scrollHeight - targetEl.clientHeight);
    };

    editor.addEventListener('scroll', () => scrollSyncHandler('editor'));
    preview.addEventListener('scroll', () => scrollSyncHandler('preview'));
}

function removeScrollSync() {
    const editor = document.getElementById('note-body');
    const preview = document.getElementById('note-preview');

    // Reset listeners by recreating the function (simple approach)
    // A more robust approach would store and remove named listeners.
    // For now, the handler checks isSplitMode and isScrollSyncEnabled, so it's safe.
}

window.toggleScrollSync = () => {
    isScrollSyncEnabled = !isScrollSyncEnabled;
    const btn = document.getElementById('scroll-sync-btn');

    if (isScrollSyncEnabled) {
        btn.classList.add('text-green-500', 'bg-green-50', 'dark:bg-green-900/20');
        btn.querySelector('span:not(.material-symbols-outlined)').innerText = 'Sync On';
    } else {
        btn.classList.remove('text-green-500', 'bg-green-50', 'dark:bg-green-900/20');
        btn.querySelector('span:not(.material-symbols-outlined)').innerText = 'Sync';
    }
};

window.togglePreviewMode = async () => {
    // Disable split mode if active
    if (isSplitMode) {
        await window.toggleSplitMode();
        // Then continue to toggle to preview... or just stop? 
        // User clicked Preview button while in Split.
        // Let's just switch to full preview.
    }

    isPreviewMode = !isPreviewMode;
    const editor = document.getElementById('note-body');
    const preview = document.getElementById('note-preview');
    const btnText = document.getElementById('preview-btn-text');

    if (isPreviewMode) {
        await renderMarkdownPreview(); // Wait for render (async due to DB calls)
        editor.classList.add('hidden');
        preview.classList.remove('hidden');
        btnText.innerText = 'Edit';
    } else {
        editor.classList.remove('hidden');
        preview.classList.add('hidden');
        btnText.innerText = 'Preview';
    }
};

// --- Markdown & Mermaid ---

// Initialize Mermaid (disable auto-start to control it manually)
if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, theme: 'default' });
}

// --- Export & Print ---

function exportNote() {
    if (!activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;

    // Convert Markdown to HTML
    const htmlContent = safeMarkedParse(note.body);

    // Create a standalone HTML document
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${note.title || 'Note'}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            color: #333;
        }
        h1 { border-bottom: 2px solid #eaeaea; padding-bottom: 0.5rem; }
        pre {
            background: #f4f4f4;
            padding: 1rem;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            background: #f4f4f4;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-family: monospace;
        }
        blockquote {
            border-left: 4px solid #ccc;
            margin: 0;
            padding-left: 1rem;
            color: #666;
        }
        img { max-width: 100%; height: auto; border-radius: 8px; }
        table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f8f9fa; }
        .mermaid { text-align: center; margin: 1rem 0; }
    </style>
</head>
<body>
    <h1>${escapeHtml(note.title || 'Untitled')}</h1>
    ${htmlContent}
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <script>
        mermaid.initialize({ startOnLoad: true });
    </script>
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.title || 'note'}.html`;
    a.click();
    URL.revokeObjectURL(url);
}

async function printNote() {
    if (!activeNoteId) return;

    // Ensure we are in preview mode
    if (!isPreviewMode) {
        await togglePreviewMode();
    }

    // Allow a slight buffer for Mermaid to render if present
    setTimeout(() => {
        window.print();
    }, 500);
}


// AI Auto-Tagging
async function triggerAutoTag() {
    if (!activeNoteId) return;

    const btn = document.getElementById('ai-tag-btn');
    btn.classList.add('animate-spin'); // Simple spin effect

    const note = notes.find(n => n.id === activeNoteId);
    if (!note || !note.body) {
        btn.classList.remove('animate-spin');
        return;
    }

    try {
        const generatedTags = await AIService.generateTags(note.body);

        if (generatedTags.length > 0) {
            // Merge tags
            const newTags = [...new Set([...note.tags, ...generatedTags])];
            note.tags = newTags;
            await saveCurrentNote();
            updateTagsUI(note.tags);
            updateSyncStatus('Tags Generated!');
        } else {
            updateSyncStatus('No tags generated', true);
        }
    } catch (e) {
        console.error(e);
        updateSyncStatus('AI Offline', true);
    } finally {
        btn.classList.remove('animate-spin');
    }
}

async function triggerSummarize() {
    if (!activeNoteId) return;

    const btn = document.getElementById('ai-summary-btn');
    if (btn) btn.classList.add('animate-spin');

    const note = notes.find(n => n.id === activeNoteId);
    if (!note || !note.body) {
        if (btn) btn.classList.remove('animate-spin');
        return;
    }

    try {
        const summary = await AIService.summarize(note.body);
        if (summary) {
            note.summary = summary;
            await saveCurrentNote();
            updateSyncStatus('Summary Generated!');
            // Show summary in a simple alert for now, or could use a modal
            alert("Summary Generated:\n\n" + summary);
        } else {
            updateSyncStatus('No summary generated', true);
        }
    } catch (e) {
        console.error(e);
        updateSyncStatus('AI Offline', true);
    } finally {
        if (btn) btn.classList.remove('animate-spin');
    }
}

async function triggerAIConnect() {
    if (!activeNoteId) return;

    const btn = document.getElementById('ai-connect-btn');
    if (btn) btn.classList.add('animate-spin');

    const note = notes.find(n => n.id === activeNoteId);
    if (!note || !note.body) {
        if (btn) btn.classList.remove('animate-spin');
        return;
    }

    try {
        // Exclude current note from context
        const otherNotes = notes.filter(n => n.id !== activeNoteId);

        const relatedIds = await AIService.findRelatedNotes(note.body, otherNotes);

        if (relatedIds && relatedIds.length > 0) {
            note.aiLinks = relatedIds;

            await saveCurrentNote();
            updateSyncStatus(`Linked to ${relatedIds.length} notes!`);

            // Refresh graph immediately
            if (document.getElementById('graph-container') && !document.getElementById('graph-container').classList.contains('hidden')) {
                if (window.renderGraph) renderGraph('graph-container');
            }
        } else {
            updateSyncStatus('No relations found', true);
        }
    } catch (e) {
        console.error(e);
        updateSyncStatus('AI Offline', true);
    } finally {
        if (btn) btn.classList.remove('animate-spin');
    }
}

function updateSyncStatus(msg = 'Note saved', isError = false) {
    const status = document.getElementById('sync-status');
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');

    status.style.opacity = '1';

    // Trigger Toast
    toastMsg.innerText = msg;
    if (isError) toastMsg.classList.add('text-red-500');
    else toastMsg.classList.remove('text-red-500');

    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%, 0)';

    setTimeout(() => {
        status.style.opacity = '0';
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, 10px)';
    }, 2000);
}

// --- Settings & Configuration ---

const settingsModal = document.getElementById('settings-modal');
const settingsModelSelect = document.getElementById('settings-model');

async function openSettings() {
    settingsModal.classList.remove('hidden');

    // Load Models
    settingsModelSelect.innerHTML = '<option disabled>Loading...</option>';
    const models = await AIService.getModels();

    settingsModelSelect.innerHTML = '';
    if (models.length === 0) {
        const option = document.createElement('option');
        option.text = "Error fetching models (Ollama offline?)";
        option.disabled = true;
        settingsModelSelect.add(option);

        // Add fallback
        const fallback = document.createElement('option');
        fallback.text = "llama2:7b";
        fallback.value = "llama2:7b";
        settingsModelSelect.add(fallback);
    } else {
        models.forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            option.text = m;
            settingsModelSelect.add(option);
        });
    }

    // Set current selection
    settingsModelSelect.value = AIService.model;
}

function closeSettings() {
    settingsModal.classList.add('hidden');
}

async function saveSettings() {
    const selectedModel = settingsModelSelect.value;
    if (selectedModel) {
        AIService.setModel(selectedModel);

        // Persist to DB
        try {
            await db.settings.put({ key: 'ai_model', value: selectedModel });
            updateSyncStatus('Settings Saved');
        } catch (e) {
            console.error('Failed to save settings:', e);
            updateSyncStatus('Error saving settings', true);
        }

        closeSettings();
    }
}

// Close on click outside
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
});



// Dark Mode with localStorage persistence
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
    } else if (savedTheme === 'light') {
        document.documentElement.classList.remove('dark');
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
    }
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// Initialize theme on load
initTheme();

// --- Advanced Org Logic ---

let folders = [];
let smartViews = [];
let activeFolderId = null; // Filter state

async function refreshFolders() {
    folders = await FolderDAO.getAll();
    renderFolderTree();
    updateFolderSelect();
}

async function refreshSmartViews() {
    smartViews = await SmartViewDAO.getAll();
    renderSmartViews();
}

// Render Folder Tree (Recursive)
function renderFolderTree() {
    const container = document.getElementById('folder-tree');
    if (!container) return; // Guard

    if (folders.length === 0) {
        container.innerHTML = '<div class="p-4 text-center text-xs text-gray-400 italic">No folders</div>';
        return;
    }

    const buildTree = (parentId) => {
        return folders
            .filter(f => f.parentId === parentId)
            .map(f => {
                const isActive = activeFolderId === f.id;
                return `
                <div class="pl-2">
                    <div onclick="filterByFolder('${f.id}')" 
                        class="folder-item ${isActive ? 'active' : ''}">
                        <span class="material-symbols-outlined text-[18px]">${isActive ? 'folder_open' : 'folder'}</span>
                        <span class="truncate">${f.name}</span>
                        ${isActive ? '<span class="ml-auto material-symbols-outlined text-[14px] cursor-pointer hover:text-red-500" onclick="deleteFolder(event, \'' + f.id + '\')">delete</span>' : ''}
                    </div>
                    ${buildTree(f.id)}
                </div>
                `;
            }).join('');
    };

    container.innerHTML = buildTree(null);
}

function renderSmartViews() {
    const container = document.getElementById('smart-views-list');
    if (!container) return;

    container.innerHTML = smartViews.map(v => `
        <div onclick="applySmartView('${v.id}')" class="smart-view-item">
            <span class="material-symbols-outlined text-[18px] text-purple-400">${v.icon || 'filter_list'}</span>
            <span class="truncate">${v.name}</span>
             <span class="ml-auto material-symbols-outlined text-[14px] opacity-0 hover:opacity-100 cursor-pointer hover:text-red-500" onclick="deleteSmartView(event, '${v.id}')">close</span>
        </div>
    `).join('');
}

function updateFolderSelect() {
    const select = document.getElementById('note-folder-select');
    if (!select) return;

    const currentVal = select.value;
    // Keep "No Folder" option
    let html = '<option value="">No Folder</option>';

    // Flatten for select
    folders.forEach(f => {
        html += `<option value="${f.id}">${f.name}</option>`;
    });

    select.innerHTML = html;

    // Restore selection if curr active note needs it
    if (activeNoteId) {
        const note = notes.find(n => n.id === activeNoteId);
        if (note && note.folderId) select.value = note.folderId;
    }
}

// Actions
window.createNewFolder = async () => {
    const name = prompt("Folder Name:");
    if (name) {
        await FolderDAO.create(name);
        refreshFolders();
    }
};

window.deleteFolder = async (e, id) => {
    e.stopPropagation();
    if (confirm("Delete folder? Notes will move to root.")) {
        await FolderDAO.delete(id);
        refreshFolders();
        // If we were filtering by this folder, reset
        if (activeFolderId === id) filterByFolder(null);
    }
};

window.createSmartView = async () => {
    const query = document.getElementById('search-input').value;
    if (!query) return alert("Type a search query first!");

    const name = prompt("Name for this view:", query);
    if (name) {
        await SmartViewDAO.create(name, query);
        refreshSmartViews();
    }
};

window.deleteSmartView = async (e, id) => {
    e.stopPropagation();
    if (confirm("Delete view?")) {
        await SmartViewDAO.delete(id);
        refreshSmartViews();
    }
};

window.filterByFolder = (id) => {
    activeFolderId = id;
    renderNoteList(); // Re-render list with filter
    renderFolderTree(); // Re-render tree to show active state
};

window.applySmartView = (id) => {
    const view = smartViews.find(v => v.id === id);
    if (view) {
        document.getElementById('search-input').value = view.query;
        // Trigger search
        refreshNotes('all', view.query);
    }
};

window.moveCurrentNote = async (folderId) => {
    if (!activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    note.folderId = folderId || null; // Handle empty string
    await saveCurrentNote();
    // Refresh list if we are currently filtering by folder
    if (activeFolderId && activeFolderId !== note.folderId) {
        renderNoteList();
    }
};


// Initial Load
// We listen for 'db-ready' event from db.js or just call refresh
window.addEventListener('db-ready', () => {
    const hydrationPromise = notesReliability
        ? notesReliability.hydrateFromFilesystemIfNeeded()
        : Promise.resolve();
    hydrationPromise.then(() => {
        Promise.all([
            refreshNotes(),
            refreshFolders(),
            refreshSmartViews()
        ]).then(() => {
            if (notes.length > 0) setActiveNote(notes[0].id);
        });
    });

    // Load Settings
    db.settings.get('ai_model').then(record => {
        if (record && record.value) {
            AIService.setModel(record.value);
        }
    }).catch(console.warn);

    // Periodic safety mirror to filesystem markdown files.
    setInterval(() => {
        if (notesReliability) notesReliability.queueFilesystemSync();
    }, 2 * 60 * 1000);
});

window.addEventListener('beforeunload', () => {
    if (notesReliability) notesReliability.queueFilesystemSync();
});

// --- Editor Power-Ups ---

// 1. Drag & Drop Images
const editorBody = document.getElementById('note-body');

editorBody.addEventListener('paste', async (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            e.preventDefault();
            const blob = item.getAsFile();
            await handleImageUpload(blob);
        }
    }
});

editorBody.addEventListener('dragover', (e) => {
    e.preventDefault();
    editorBody.classList.add('bg-blue-50', 'dark:bg-blue-900/10');
});

editorBody.addEventListener('dragleave', (e) => {
    e.preventDefault();
    editorBody.classList.remove('bg-blue-50', 'dark:bg-blue-900/10');
});

editorBody.addEventListener('drop', async (e) => {
    e.preventDefault();
    editorBody.classList.remove('bg-blue-50', 'dark:bg-blue-900/10');

    if (e.dataTransfer.items) {
        for (const item of e.dataTransfer.items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                await handleImageUpload(file);
            }
        }
    }
});

async function handleImageUpload(blob) {
    if (!activeNoteId) return alert("Select a note first!");

    try {
        updateSyncStatus("Uploading image...", false);
        const id = await AttachmentDAO.save(blob, activeNoteId);

        // Insert markdown at cursor
        const cursorPos = editorBody.selectionStart;
        const textBefore = editorBody.value.substring(0, cursorPos);
        const textAfter = editorBody.value.substring(cursorPos);

        const imageMarkdown = `\n![Image](attachment:${id})\n`;

        editorBody.value = textBefore + imageMarkdown + textAfter;

        // Trigger save
        const event = new Event('input');
        editorBody.dispatchEvent(event);

        updateSyncStatus("Image attached!");
    } catch (e) {
        console.error("Upload failed", e);
        updateSyncStatus("Image upload failed", true);
    }
}

// --- Data Management (Import/Export) ---

async function exportData() {
    try {
        updateSyncStatus("Exporting data...", false);
        const data = {
            version: 1,
            timestamp: Date.now(),
            notes: await db.notes.toArray(),
            folders: await db.folders.toArray(),
            smartViews: await db.smart_views.toArray(),
            // We usually don't export embeddings/vectors as they can be regenerated and are large
            // But we SHOULD export attachments
            attachments: await db.attachments.toArray()
        };

        const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `smartnotes_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        updateSyncStatus("Export complete!");
    } catch (e) {
        console.error("Export failed:", e);
        alert("Export failed: " + e.message);
    }
}

async function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!confirm("This will overwrite/merge with your current data. It's recommended to export a backup first. Continue?")) return;

        try {
            updateSyncStatus("Importing data...", false);
            const text = await file.text();
            const data = JSON.parse(text);

            await db.transaction('rw', db.notes, db.folders, db.smart_views, db.attachments, async () => {
                if (data.notes) await db.notes.bulkPut(data.notes);
                if (data.folders) await db.folders.bulkPut(data.folders);
                if (data.smartViews) await db.smart_views.bulkPut(data.smartViews);
                if (data.attachments) await db.attachments.bulkPut(data.attachments);
            });

            updateSyncStatus("Import complete!");
            window.location.reload(); // Reload to reflect changes
        } catch (err) {
            console.error("Import failed:", err);
            alert("Import failed: " + err.message);
        }
    };
    input.click();
}

// Minimal toast helper used by multiple modules
function showToast(message, isError) {
    try {
        let toast = document.getElementById('toast');
        let msg = document.getElementById('toast-message');
        if (!toast || !msg) {
            // Create a simple toast container if not present
            toast = document.createElement('div');
            toast.id = 'toast';
            Object.assign(toast.style, { position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)', padding: '10px 14px', borderRadius: '6px', zIndex: 9999, transition: 'opacity 0.2s ease', opacity: 0 });
            msg = document.createElement('div');
            msg.id = 'toast-message';
            toast.appendChild(msg);
            document.body.appendChild(toast);
        }
        msg.innerHTML = message;
        toast.style.background = isError ? '#b91c1c' : '#111827';
        toast.style.color = '#fff';
        toast.style.opacity = 1;
        setTimeout(() => { toast.style.opacity = 0; }, 4000);
    } catch (e) {
        console.warn('showToast failed:', e);
    }
}

// 3. Interactive Checkboxes Handler
document.getElementById('note-preview').addEventListener('change', (e) => {
    if (e.target.classList.contains('task-checkbox')) {
        const checkboxes = document.querySelectorAll('#note-preview .task-checkbox');
        const index = Array.from(checkboxes).indexOf(e.target);
        if (index !== -1) {
            toggleCheckboxInSource(index, e.target.checked);
        }
    }
});

function toggleCheckboxInSource(index, isChecked) {
    const editor = document.getElementById('note-body');
    const lines = editor.value.split('\n');
    let taskCount = 0;

    // Find the Nth task in the source
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const taskMatch = line.match(/^(\s*)- \[[x ]\]/); // match "- [ ]" or "- [x]"

        if (taskMatch) {
            if (taskCount === index) {
                // Toggle it
                const newMark = isChecked ? '[x]' : '[ ]';
                lines[i] = line.replace(/- \[[x ]\]/, `- ${newMark}`);
                break;
            }
            taskCount++;
        }
    }

    editor.value = lines.join('\n');

    // Trigger Save (but don't re-render preview immediately to lose focus/scroll, wait for debounce)
    const event = new Event('input');
    editor.dispatchEvent(event);
}

// --- Chat Interface Logic (ChatGPT-style) ---

const chatState = window.ChatUIService && typeof window.ChatUIService.createChatState === 'function'
    ? window.ChatUIService.createChatState()
    : {
        history: [],
        activeConversationId: null,
        mentionQuery: null,
        isMentioning: false,
        mentionedNotes: new Set()
    };

const ChatManager = {
    ...chatState,

    // --- View Toggles ---
    async toggleMiniChat() {
        const pane = document.getElementById('chat-pane');
        pane.classList.toggle('hidden');
        if (!pane.classList.contains('hidden')) {
            setTimeout(() => document.getElementById('chat-input').focus(), 100);
            // If no active conversation, try to load the most recent or create new
            if (!this.activeConversationId) {
                const convs = await ConversationDAO.getAll();
                if (convs.length > 0) {
                    await this.loadConversation(convs[0].id);
                } else {
                    await this.createNewConversation();
                }
            } else {
                // Reload current conversation to sync UI
                await this.loadConversation(this.activeConversationId);
            }
        }
    },

    async openFullScreen() {
        document.getElementById('chat-pane').classList.add('hidden'); // Close mini
        document.getElementById('chat-screen').classList.remove('hidden');

        // Load conversation list
        await this.renderConversationList();

        // If no active conversation, create one
        if (!this.activeConversationId) {
            await this.createNewConversation();
        } else {
            await this.loadConversation(this.activeConversationId);
        }

        setTimeout(() => document.getElementById('chat-screen-input').focus(), 100);
    },

    closeFullScreen() {
        document.getElementById('chat-screen').classList.add('hidden');
    },

    // --- Conversation Management ---
    async createNewConversation() {
        const conv = await ConversationDAO.create('New Chat');
        this.activeConversationId = conv.id;
        this.history = [];

        // Clear both message containers
        document.getElementById('chat-messages').innerHTML = this.getWelcomeMessage();
        document.getElementById('chat-screen-messages').innerHTML = this.getWelcomeMessage();
        document.getElementById('chat-screen-title').textContent = conv.title;

        // Refresh sidebar
        await this.renderConversationList();
    },

    async loadConversation(id) {
        this.activeConversationId = id;
        const messages = await ChatMessageDAO.getByConversationId(id);
        const conv = await ConversationDAO.get(id);

        // Update history for AI context
        this.history = messages.map(m => ({ role: m.role, content: m.content }));

        // Render to both containers
        this.renderMessagesToContainer('chat-messages', messages);
        this.renderMessagesToContainer('chat-screen-messages', messages);

        // Update title
        document.getElementById('chat-screen-title').textContent = conv?.title || 'Chat';

        // Highlight in sidebar
        this.highlightConversation(id);
    },

    async deleteCurrentConversation() {
        if (!this.activeConversationId) return;
        if (!confirm('Delete this conversation?')) return;

        await ConversationDAO.delete(this.activeConversationId);
        this.activeConversationId = null;
        this.history = [];

        // Reload or create new
        const allConvs = await ConversationDAO.getAll();
        if (allConvs.length > 0) {
            await this.loadConversation(allConvs[0].id);
        } else {
            await this.createNewConversation();
        }
        await this.renderConversationList();
    },

    async renderConversationList() {
        const convs = await ConversationDAO.getAll();
        if (window.ChatUIService) {
            window.ChatUIService.renderConversationList('conversation-list', convs, this.activeConversationId);
        }
    },

    highlightConversation(id) {
        if (window.ChatUIService) {
            window.ChatUIService.highlightConversation('conversation-list', id);
        }
    },

    renderMessagesToContainer(containerId, messages) {
        if (window.ChatUIService) {
            window.ChatUIService.renderMessagesToContainer(containerId, messages);
        }
    },

    getWelcomeMessage() {
        return window.ChatUIService ? window.ChatUIService.getWelcomeMessage() : '';
    },

    createMessageHTML(role, text, isThinking = false) {
        return window.ChatUIService
            ? window.ChatUIService.createMessageHTML(role, text, isThinking)
            : '';
    },

    // --- Input Handling ---
    adjustHeight(el) {
        if (window.ChatUIService) {
            window.ChatUIService.adjustInputHeight(el, 128);
        }
    },

    handleInput(el, mode = 'mini') {
        const val = el.value;
        const cursor = el.selectionStart;
        const lastAt = val.lastIndexOf('@', cursor - 1);

        if (lastAt !== -1) {
            const textAfterAt = val.substring(lastAt + 1, cursor);
            const charBefore = val[lastAt - 1];
            if (!charBefore || /\s/.test(charBefore)) {
                this.isMentioning = true;
                this.mentionQuery = textAfterAt.toLowerCase();
                this.showMentions(this.mentionQuery, lastAt, mode);
                return;
            }
        }
        this.hideMentions();
        this.isMentioning = false;
    },

    handleKeydown(e, mode = 'mini') {
        if (this.isMentioning) {
            const suggestions = document.getElementById('mention-suggestions');
            if (!suggestions.classList.contains('hidden')) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const firstItem = suggestions.firstElementChild;
                    if (firstItem) firstItem.click();
                    return;
                }
                if (e.key === 'Escape') {
                    this.hideMentions();
                    return;
                }
            }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage(mode);
        }
    },

    showMentions(query, atIndex, mode = 'mini') {
        const container = document.getElementById('mention-suggestions');
        const matches = notes.filter(n => n.title.toLowerCase().includes(query)).slice(0, 5);

        if (matches.length === 0) {
            container.classList.add('hidden');
            return;
        }

        container.innerHTML = matches.map(n => `
            <div onclick="ChatManager.insertMention('${n.id}', '${n.title.replace(/'/g, "\\'")}', ${atIndex}, '${mode}')"
                class="px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2">
                <span class="material-symbols-outlined text-gray-400 text-xs">description</span>
                <span class="font-medium text-gray-700 dark:text-gray-200 truncate">${n.title}</span>
            </div>
        `).join('');
        container.classList.remove('hidden');
    },

    hideMentions() {
        document.getElementById('mention-suggestions').classList.add('hidden');
        this.isMentioning = false;
    },

    insertMention(noteId, title, atIndex, mode = 'mini') {
        const inputId = mode === 'mini' ? 'chat-input' : 'chat-screen-input';
        const input = document.getElementById(inputId);
        const val = input.value;
        const cursor = input.selectionStart;

        const before = val.substring(0, atIndex);
        const after = val.substring(cursor);
        const mentionText = `@${title} `;

        input.value = before + mentionText + after;
        this.mentionedNotes.add(noteId);
        this.hideMentions();
        input.focus();
    },

    // --- Send Message ---
    async sendMessage(mode = 'mini') {
        const inputId = mode === 'mini' ? 'chat-input' : 'chat-screen-input';
        const messagesId = mode === 'mini' ? 'chat-messages' : 'chat-screen-messages';
        const input = document.getElementById(inputId);
        const message = input.value.trim();
        if (!message) return;

        // Ensure conversation exists
        if (!this.activeConversationId) {
            await this.createNewConversation();
        }

        // UI: Add User Message
        this.addMessageToUI(messagesId, 'user', message);
        input.value = '';
        input.style.height = 'auto';

        // Save USER message to DB
        await ChatMessageDAO.save({
            conversationId: this.activeConversationId,
            role: 'user',
            content: message
        });

        // Update history
        this.history.push({ role: 'user', content: message });

        // Update conversation title on first user message
        if (this.history.length === 1) { // 1 because we just pushed
            const title = message.substring(0, 50) + (message.length > 50 ? '...' : '');
            await ConversationDAO.updateTitle(this.activeConversationId, title);
            document.getElementById('chat-screen-title').textContent = title;
            this.renderConversationList();
        }

        // UI: Add Thinking Placeholder
        const thinkingId = this.addMessageToUI(messagesId, 'ai', 'Thinking...', true);

        try {
            const reply = window.ChatRagService
                ? await window.ChatRagService.generateAssistantReply({
                    message,
                    notes,
                    activeNoteId,
                    history: this.history,
                    aiChat: (messages) => AIService.chat(messages),
                    executeTool: async (toolCall) => {
                        return window.AITools.execute(toolCall.tool, toolCall.arguments);
                    },
                    onToolExecution: (toolCall) => {
                        this.updateMessageInUI(messagesId, thinkingId, `Executing ${toolCall.tool}...`);
                    },
                    maxTurns: 5
                })
                : { finalResponse: 'Unable to generate a response right now.' };

            const finalResponse = reply.finalResponse;

            // Save AI response to DB
            await ChatMessageDAO.save({
                conversationId: this.activeConversationId,
                role: 'assistant',
                content: finalResponse
            });

            // Update history
            this.history.push({ role: 'assistant', content: finalResponse });

            // UI: Update AI Message
            this.updateMessageInUI(messagesId, thinkingId, finalResponse);
            this.mentionedNotes.clear();

        } catch (e) {
            console.error(e);
            this.updateMessageInUI(messagesId, thinkingId, "Error: " + e.message);
        }
    },

    addMessageToUI(containerId, role, text, isThinking = false) {
        if (!window.ChatUIService) return null;
        return window.ChatUIService.addMessageToUI(containerId, role, text, isThinking);
    },

    updateMessageInUI(containerId, id, text) {
        if (window.ChatUIService) {
            window.ChatUIService.updateMessageInUI(containerId, id, text);
        }
    },

    scrollToBottom(containerId) {
        if (window.ChatUIService) {
            window.ChatUIService.scrollToBottom(containerId);
        }
    }
};

window.ChatManager = ChatManager;
