/**
 * Tab Manager Module
 * Handles multi-tab interface state and rendering
 */

const TabManager = {
    openTabs: [], // Array of { id, title }
    activeTabId: null,

    init() {
        this.render();
    },

    /**
     * Open a note in a tab
     * If already open, switch to it. If not, add it.
     */
    async open(noteId) {
        if (!noteId) return;

        // Check if already open
        const existingToken = this.openTabs.find(t => t.id === noteId);

        if (!existingToken) {
            // Fetch note title (or use cache if available in app.js notes array)
            // We assume app.js 'notes' is populated.
            const note = notes.find(n => n.id === noteId);
            const title = note ? (note.title || 'Untitled') : 'Loading...';

            this.openTabs.push({ id: noteId, title: title });
        }

        this.switch(noteId);
    },

    /**
     * Switch to a specific tab
     */
    switch(noteId) {
        this.activeTabId = noteId;
        this.render();

        // Trigger app loading
        // We assume global function from app.js is available or we dispatch event
        if (typeof setActiveNote === 'function') {
            // We bypass setActiveNote's call to TabManager.open to avoid loop? 
            // No, setActiveNote calls loadNoteIntoEditor.
            // But app.js logic currently is: click -> setActiveNote -> loadNote...
            // We need to change app.js to use TabManager.

            // For now, let's assume app.js exposes a direct loader or we call setActiveNote 
            // but we need to prevent infinite recursion if setActiveNote calls TabManager.open

            // Actually, best flow: 
            // UI Click -> TabManager.open() -> TabManager.switch() -> loadNoteIntoEditor()

            const note = notes.find(n => n.id === noteId);
            if (note) loadNoteIntoEditor(note);

            // Update app state
            activeNoteId = noteId;
            renderNoteList(); // Highlight in sidebar
        }
    },

    /**
     * Close a tab
     */
    close(noteId, event) {
        if (event) event.stopPropagation(); // Prevent tab switching when clicking close

        const idx = this.openTabs.findIndex(t => t.id === noteId);
        if (idx === -1) return;

        this.openTabs.splice(idx, 1);

        // If we closed the active tab, switch to another
        if (noteId === this.activeTabId) {
            if (this.openTabs.length > 0) {
                // Switch to the one to the right, or last one
                const newIdx = Math.min(idx, this.openTabs.length - 1);
                this.switch(this.openTabs[newIdx].id);
            } else {
                this.activeTabId = null;
                clearEditor();
                this.render();
            }
        } else {
            this.render();
        }
    },

    /**
     * Update title of a tab (e.g. when renamed)
     */
    updateTitle(noteId, newTitle) {
        const tab = this.openTabs.find(t => t.id === noteId);
        if (tab) {
            tab.title = newTitle || 'Untitled';
            this.render();
        }
    },

    render() {
        const container = document.getElementById('tab-bar');
        if (!container) return;

        container.innerHTML = this.openTabs.map(tab => `
            <div onclick="TabManager.switch('${tab.id}')" 
                 class="group flex items-center gap-2 px-3 py-2 text-sm font-medium border-r border-gray-200 dark:border-gray-800 cursor-pointer select-none transition-colors min-w-[120px] max-w-[200px] ${tab.id === this.activeTabId ? 'bg-[var(--editor-bg-light)] dark:bg-[var(--editor-bg-dark)] text-blue-600 dark:text-blue-400 border-t-2 border-t-blue-500' : 'bg-gray-50 dark:bg-gray-900 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}">
                <span class="truncate flex-1">${tab.title}</span>
                <button onclick="TabManager.close('${tab.id}', event)" 
                        class="opacity-0 group-hover:opacity-100 p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500 transition-all">
                    <span class="material-symbols-outlined text-[14px]">close</span>
                </button>
            </div>
        `).join('');

        // Add "+" button at end
        container.innerHTML += `
            <button onclick="createNewNote()" class="px-3 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                <span class="material-symbols-outlined text-[20px]">add</span>
            </button>
        `;
    }
};
