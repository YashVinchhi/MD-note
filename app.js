/**
 * Synapse Application Logic
 * Integrates: Dexie DB, UI Rendering, Event Handling
 */

// State
let notes = []; // Local cache of notes for rendering
let activeNoteId = null;
let isPreviewMode = false;

// --- Core Functions ---

// Load all notes from DB and render
async function refreshNotes(filter = 'all', searchQuery = '') {
    try {
        if (searchQuery) {
            notes = await NoteDAO.search(searchQuery);
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
        // We don't do full refresh here to avoid UI jitter, just update list item if needed
        renderNoteList();

        // Refresh Graph if active
        if (document.getElementById('graph-container') && !document.getElementById('graph-container').classList.contains('hidden')) {
            if (window.renderGraph) renderGraph('graph-container');
        }
    } catch (err) {
        console.error('Save failed:', err);
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
    const searchVal = searchQuery || document.getElementById('search-input').value.toLowerCase();

    // Filter logic (if not already filtered by DB search)
    let filteredNotes = notes.filter(n => {
        const matchesSearch = !searchQuery || // If we searched DB, assumes notes are already filtered. 
            // If search input matches what triggered DB search.
            (n.title && n.title.toLowerCase().includes(searchVal)) ||
            (n.body && n.body.toLowerCase().includes(searchVal));
        return matchesSearch;
    });

    if (filter === 'pinned') {
        filteredNotes = filteredNotes.filter(n => n.pinned);
    }

    document.getElementById('total-count').innerText = notes.length;

    container.innerHTML = filteredNotes.map(note => `
        <div onclick="setActiveNote('${note.id}')" class="group relative p-4 mb-2 rounded-xl border transition-all cursor-pointer ${note.id === activeNoteId ? 'bg-white dark:bg-gray-800 shadow-sm border-blue-500 border-l-4' : 'hover:bg-white dark:hover:bg-gray-800 border-transparent hover:border-gray-200 dark:hover:border-gray-700'}">
            <div class="flex justify-between items-start mb-1">
                <h3 class="font-semibold text-gray-900 dark:text-gray-100 line-clamp-1 ${note.id === activeNoteId ? 'text-blue-600 dark:text-blue-400' : ''}">${note.title || 'Untitled'}</h3>
                ${note.pinned ? '<span class="material-symbols-outlined text-[14px] text-blue-500">push_pin</span>' : ''}
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-3 h-10 overflow-hidden text-ellipsis">${(note.body || '').substring(0, 100).replace(/[#*`]/g, '') || 'No content...'}</p>
            <div class="flex items-center gap-2 overflow-hidden">
                ${(note.tags || []).map(tag => `<span class="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-medium border border-gray-200 dark:border-gray-600 whitespace-nowrap">#${tag}</span>`).join('')}
            </div>
        </div>
    `).join('');
}

// Graph View Toggle
function toggleGraphView() {
    const listContainer = document.getElementById('notes-list-wrapper');
    const graphContainer = document.getElementById('graph-container');
    const graphBtn = document.getElementById('graph-view-btn');

    const isGraphHidden = graphContainer.classList.contains('hidden');

    if (isGraphHidden) {
        // Show Graph
        listContainer.classList.add('hidden');
        graphContainer.classList.remove('hidden');
        graphBtn.classList.add('bg-blue-50', 'dark:bg-blue-900/20', 'text-blue-600', 'dark:text-blue-400');
        if (window.renderGraph) renderGraph('graph-container');
    } else {
        // Show List
        listContainer.classList.remove('hidden');
        graphContainer.classList.add('hidden');
        graphBtn.classList.remove('bg-blue-50', 'dark:bg-blue-900/20', 'text-blue-600', 'dark:text-blue-400');
    }
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

window.togglePreviewMode = () => {
    isPreviewMode = !isPreviewMode;
    const editor = document.getElementById('note-body');
    const preview = document.getElementById('note-preview');
    const btnText = document.getElementById('preview-btn-text');

    if (isPreviewMode) {
        renderMarkdownPreview();
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

function renderMarkdownPreview() {
    const content = document.getElementById('note-body').value;
    const preview = document.getElementById('note-preview');

    // 1. Parse Markdown (using default renderer)
    preview.innerHTML = marked.parse(content);

    // 2. Post-process: Convert <pre><code class="language-mermaid"> to <div class="mermaid">
    // Marked outputs class="language-mermaid" by default for fenced code blocks
    const mermaidCodeBlocks = preview.querySelectorAll('code.language-mermaid');

    mermaidCodeBlocks.forEach(block => {
        const diagramDefinition = block.textContent;
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = diagramDefinition;

        // Replace the parent <pre> element with the new <div>
        const pre = block.parentElement;
        if (pre && pre.tagName === 'PRE') {
            pre.replaceWith(div);
        } else {
            block.replaceWith(div);
        }
    });

    // 3. Render Mermaid
    if (window.mermaid) {
        try {
            // run() is async
            mermaid.run({
                nodes: preview.querySelectorAll('.mermaid')
            }).catch(err => {
                console.error('Mermaid Run Warning:', err);
            });
        } catch (e) {
            console.error('Mermaid Initialization Error:', e);
            preview.innerHTML += `<div class="p-4 text-red-500 bg-red-100 rounded">Mermaid Error: ${e.message}</div>`;
        }
    }
}

// --- Export & Print ---

function exportNote() {
    if (!activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;

    const blob = new Blob([note.body], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.title || 'note'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

function printNote() {
    if (!activeNoteId) return;
    // Switch to preview mode for printing if not already
    if (!isPreviewMode) togglePreviewMode();
    setTimeout(() => window.print(), 500); // Wait for render
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




// Check Dark Mode
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
}

// Initial Load
// We listen for 'db-ready' event from db.js or just call refresh
window.addEventListener('db-ready', () => {
    refreshNotes().then(() => {
        if (notes.length > 0) setActiveNote(notes[0].id);
    });

    // Load Settings
    db.settings.get('ai_model').then(record => {
        if (record && record.value) {
            AIService.setModel(record.value);
        }
    }).catch(console.warn);
});
