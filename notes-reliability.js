(function (global) {
    function createFileSyncService(deps) {
        const noteDAO = deps.NoteDAO;
        const fetchImpl = deps.fetchImpl;
        const apiContracts = deps.ApiContracts || null;
        const syncDelayMs = typeof deps.syncDelayMs === 'number' ? deps.syncDelayMs : 2500;

        let fileSyncTimer = null;
        let fileSyncQueued = false;

        async function syncNotesToFilesystem() {
            if (!noteDAO || !fetchImpl) return;
            try {
                const allNotes = await noteDAO.getAll();
                const requestPayload = { notes: allNotes };
                if (apiContracts) {
                    apiContracts.validateRequest('/api/file-notes/sync', requestPayload);
                }

                const res = await fetchImpl('/api/file-notes/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestPayload)
                });

                if (!res || !res.ok) {
                    throw new Error('Filesystem sync HTTP error');
                }

                const payload = await res.json();
                if (apiContracts) {
                    apiContracts.validateResponse('/api/file-notes/sync', payload);
                }
            } catch (err) {
                console.warn('Filesystem sync failed:', err);
            }
        }

        function queueFilesystemSync() {
            fileSyncQueued = true;
            if (fileSyncTimer) return;

            fileSyncTimer = setTimeout(async () => {
                fileSyncTimer = null;
                if (!fileSyncQueued) return;
                fileSyncQueued = false;
                await syncNotesToFilesystem();
            }, syncDelayMs);
        }

        async function hydrateFromFilesystemIfNeeded() {
            if (!noteDAO || !fetchImpl) return;
            try {
                const existing = await noteDAO.getAll();
                if (existing.length > 0) return;

                const res = await fetchImpl('/api/file-notes/load');
                if (!res.ok) return;

                const payload = await res.json();
                if (apiContracts) {
                    apiContracts.validateResponse('/api/file-notes/load', payload);
                }
                const fileNotes = Array.isArray(payload.notes) ? payload.notes : [];
                if (fileNotes.length === 0) return;

                for (const note of fileNotes) {
                    if (note && note.id) {
                        await noteDAO.save(note);
                    }
                }
            } catch (err) {
                console.warn('Filesystem hydrate skipped:', err);
            }
        }

        return {
            syncNotesToFilesystem,
            queueFilesystemSync,
            hydrateFromFilesystemIfNeeded
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createFileSyncService };
    }

    if (global && global.NoteDAO) {
        const service = createFileSyncService({
            NoteDAO: global.NoteDAO,
            fetchImpl: global.fetch.bind(global),
            ApiContracts: global.ApiContracts
        });

        global.FileSyncService = service;
        global.syncNotesToFilesystem = service.syncNotesToFilesystem;
        global.queueFilesystemSync = service.queueFilesystemSync;
        global.hydrateFromFilesystemIfNeeded = service.hydrateFromFilesystemIfNeeded;
    }
})(typeof window !== 'undefined' ? window : globalThis);
