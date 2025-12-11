/**
 * SynapseDB - Database Layer using Dexie.js
 * Handles storage, migration, and CRUD operations
 */

const db = new Dexie('SynapseDB');

// Define Schema
// 'id' is our primary key (string UUID from app.js)
// We index fields we want to query/filter by: tags, pinned, updatedAt
db.version(1).stores({
    notes: 'id, title, *tags, date, pinned, updatedAt, summary',
    settings: 'key' // For storing migration flags
});

/**
 * Migration from LocalStorage
 * Moves 'distraction_free_notes' to IndexedDB
 */
async function migrateFromLocalStorage() {
    try {
        // Check if already migrated
        const migrationRecord = await db.settings.get('migrated_v1');
        if (migrationRecord && migrationRecord.value) {
            console.log('Database already migrated.');
            return;
        }

        console.log('Starting migration from LocalStorage...');
        const STORAGE_KEY = 'distraction_free_notes';
        const rawData = localStorage.getItem(STORAGE_KEY);

        if (rawData) {
            const notes = JSON.parse(rawData);
            if (Array.isArray(notes) && notes.length > 0) {
                // Bulk add to Dexie
                await db.notes.bulkPut(notes);
                console.log(`Migrated ${notes.length} notes to SynapseDB.`);
            }
        }

        // Set migrated flag
        await db.settings.put({ key: 'migrated_v1', value: true });

        // Clear LocalStorage as requested (optional safety check could go here)
        localStorage.removeItem(STORAGE_KEY);
        console.log('LocalStorage cleared.');

    } catch (error) {
        console.error('Migration failed:', error);
        alert('Database migration encountered an error. Please check console.');
    }
}

/**
 * Data Access Object (DAO) for Notes
 */
const NoteDAO = {
    /**
     * Get all notes, sorted by pinned status then updatedAt
     */
    async getAll() {
        // Dexie sorting capabilities are basic, we'll sort in memory or use logic
        // For efficiency, we just get array and sort in JS as we did before, 
        // unless dataset is huge.
        const notes = await db.notes.toArray();
        return notes.sort((a, b) => {
            if (a.pinned === b.pinned) return b.updatedAt - a.updatedAt;
            return a.pinned ? -1 : 1;
        });
    },

    async get(id) {
        return await db.notes.get(id);
    },

    async save(note) {
        // Ensure id exists
        if (!note.id) note.id = Date.now().toString();
        note.updatedAt = Date.now();
        // Extract wiki links (placeholder for now, will implement logic in app.js/service)
        note.wikiLinks = note.wikiLinks || [];

        await db.notes.put(note);
        return note;
    },

    async delete(id) {
        await db.notes.delete(id);
    },

    async search(query) {
        if (!query) return this.getAll();
        const lowerQuery = query.toLowerCase();

        // Advanced: use Dexie's collection capabilities
        // Simple implementation: filter in memory usually fast enough for personal notes
        // For Scale: db.notes.where('title').startsWithIgnoreCase(...) could be used

        return await db.notes.filter(note => {
            return (note.title && note.title.toLowerCase().includes(lowerQuery)) ||
                (note.body && note.body.toLowerCase().includes(lowerQuery)) ||
                (note.tags && note.tags.some(t => t.toLowerCase().includes(lowerQuery)));
        }).toArray();
    }
};

// Initialize migration immediately
migrateFromLocalStorage().then(() => {
    // Notify app that DB is ready? 
    // Usually we just let the app call getAll() and it will wait for the promise if we structured it right,
    // but migration is async. 
    // We will emit an event or just let app.js call helper functions.
    console.log('SynapseDB Ready');
    window.dispatchEvent(new Event('db-ready'));
});
