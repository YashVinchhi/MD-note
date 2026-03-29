(function (global) {
    function createNoteListService(deps) {
        const escapeHtml = deps.escapeHtml;

        function tagHtml(tag, nestedTagRendering) {
            const safeTag = escapeHtml(tag || '');
            if (!nestedTagRendering || !safeTag.includes('/')) {
                return `<span class="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-medium border border-gray-200 dark:border-gray-600 whitespace-nowrap">#${safeTag}</span>`;
            }

            const parts = safeTag.split('/');
            return `<span class="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-medium border border-gray-200 dark:border-gray-600 whitespace-nowrap flex items-center gap-0.5"><span class="opacity-50">${parts[0]}/</span><span>${parts.slice(1).join('/')}</span></span>`;
        }

        function filterNotes(inputNotes, options) {
            const notes = Array.isArray(inputNotes) ? inputNotes : [];
            const filter = options.filter || 'all';
            const rawSearch = (options.searchQuery || '').toLowerCase();
            const activeFolderId = options.activeFolderId || null;
            const includeTagsInSearch = options.includeTagsInSearch !== false;

            let filtered = notes.filter((n) => {
                if (activeFolderId && n.folderId !== activeFolderId) return false;

                if (!rawSearch) return true;

                const titleHit = n.title && n.title.toLowerCase().includes(rawSearch);
                const bodyHit = n.body && n.body.toLowerCase().includes(rawSearch);
                const tagHit = includeTagsInSearch && Array.isArray(n.tags) && n.tags.some((t) => (t || '').toLowerCase().includes(rawSearch));
                return titleHit || bodyHit || tagHit;
            });

            if (filter === 'pinned') {
                filtered = filtered.filter((n) => n.pinned);
            }

            return filtered;
        }

        function renderNoteListHtml(inputNotes, options) {
            const activeNoteId = options.activeNoteId;
            const nestedTagRendering = !!options.nestedTagRendering;

            return (inputNotes || []).map((note) => `
                <div onclick="setActiveNote('${note.id}')" class="group relative p-4 mb-2 rounded-xl border transition-all cursor-pointer ${note.id === activeNoteId ? 'bg-white dark:bg-gray-800 shadow-sm border-blue-500 border-l-4' : 'hover:bg-white dark:hover:bg-gray-800 border-transparent hover:border-gray-200 dark:hover:border-gray-700'}">
                    <div class="flex justify-between items-start mb-1">
                        <h3 class="font-semibold text-gray-900 dark:text-gray-100 line-clamp-1 ${note.id === activeNoteId ? 'text-blue-600 dark:text-blue-400' : ''}">${escapeHtml(note.title || 'Untitled')}</h3>
                        ${note.pinned ? '<span class="material-symbols-outlined text-[14px] text-blue-500">push_pin</span>' : ''}
                    </div>
                    <p class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-3 h-10 overflow-hidden text-ellipsis">${escapeHtml((note.body || '').substring(0, 100).replace(/[#*`]/g, '') || 'No content...')}</p>
                    <div class="flex items-center gap-2 overflow-hidden ${nestedTagRendering ? 'flex-wrap' : ''}">
                        ${(note.tags || []).map((tag) => tagHtml(tag, nestedTagRendering)).join('')}
                    </div>
                </div>
            `).join('');
        }

        return {
            filterNotes,
            renderNoteListHtml
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createNoteListService };
    }

    if (global && global.escapeHtml) {
        global.NoteListService = createNoteListService({
            escapeHtml: global.escapeHtml
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
