/**
 * SynapseDB - Database Layer using Dexie.js
 * Handles storage, migration, and CRUD operations
 */

const db = new Dexie('SynapseDB');

// Define Schema
// 'id' is our primary key (string UUID from app.js)
// We index fields we want to query/filter by: tags, pinned, updatedAt
db.version(1).stores({
    notes: 'id, title, *tags, date, pinned, updatedAt, summary', // v1 schema
    settings: 'key'
});

// Upgrade to v2
db.version(2).stores({
    notes: 'id, title, *tags, date, pinned, updatedAt, summary, folderId', // Added folderId
    settings: 'key',
    folders: 'id, parentId, name, collapsed',
    smart_views: 'id, name, query, icon'
});

// Upgrade to v3
db.version(3).stores({
    notes: 'id, title, *tags, date, pinned, updatedAt, summary, folderId',
    settings: 'key',
    folders: 'id, parentId, name, collapsed',
    smart_views: 'id, name, query, icon',
    attachments: 'id, noteId, type, createdAt'
});

// Upgrade to v4
db.version(4).stores({
    notes: 'id, title, *tags, date, pinned, updatedAt, summary, folderId',
    settings: 'key',
    folders: 'id, parentId, name, collapsed',
    smart_views: 'id, name, query, icon',
    attachments: 'id, noteId, type, createdAt',
    embeddings: 'noteId, updatedAt' // vector is stored as non-indexed property
});

// Upgrade to v5 - Chat History
db.version(5).stores({
    notes: 'id, title, *tags, date, pinned, updatedAt, summary, folderId',
    settings: 'key',
    folders: 'id, parentId, name, collapsed',
    smart_views: 'id, name, query, icon',
    attachments: 'id, noteId, type, createdAt',
    embeddings: 'noteId, updatedAt',
    conversations: 'id, title, createdAt, updatedAt',
    chat_messages: 'id, conversationId, role, timestamp'
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
        return await db.notes.put(note);
    },
    async delete(id) {
        return await db.notes.delete(id);
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

const FolderDAO = {
    async getAll() {
        return await db.folders.toArray();
    },
    async create(name, parentId = null) {
        const folder = { id: Date.now().toString(), name, parentId, collapsed: false };
        await db.folders.put(folder);
        return folder;
    },
    async delete(id) {
        // Simple delete (orphans notes? or moves to root? forcing root for now)
        // Ideally should update all notes with this folderId to null
        await db.transaction('rw', db.notes, db.folders, async () => {
            await db.notes.where('folderId').equals(id).modify({ folderId: null });
            await db.folders.delete(id);
        });
    }
};

const SmartViewDAO = {
    async getAll() {
        return await db.smart_views.toArray();
    },
    async create(name, query, icon = 'filter_list') {
        const view = { id: Date.now().toString(), name, query, icon };
        await db.smart_views.put(view);
        return view;
    },
    async delete(id) {
        await db.smart_views.delete(id);
    }
};

const AttachmentDAO = {
    async save(blob, noteId) {
        const id = crypto.randomUUID();
        await db.attachments.put({
            id,
            noteId,
            blob,
            type: blob.type,
            createdAt: Date.now()
        });
        return id;
    },
    async get(id) {
        return await db.attachments.get(id);
    }
};

/**
 * DAO for Conversations (ChatGPT-style threads)
 */
const ConversationDAO = {
    async getAll() {
        return await db.conversations.orderBy('updatedAt').reverse().toArray();
    },
    async get(id) {
        return await db.conversations.get(id);
    },
    async create(title = 'New Chat') {
        const id = crypto.randomUUID();
        const now = Date.now();
        const conversation = { id, title, createdAt: now, updatedAt: now };
        await db.conversations.put(conversation);
        return conversation;
    },
    async updateTitle(id, title) {
        await db.conversations.update(id, { title, updatedAt: Date.now() });
    },
    async touch(id) {
        await db.conversations.update(id, { updatedAt: Date.now() });
    },
    async delete(id) {
        await db.transaction('rw', db.conversations, db.chat_messages, async () => {
            await db.chat_messages.where('conversationId').equals(id).delete();
            await db.conversations.delete(id);
        });
    }
};

/**
 * DAO for Chat Messages
 */
const ChatMessageDAO = {
    async getByConversationId(conversationId) {
        return await db.chat_messages.where('conversationId').equals(conversationId).sortBy('timestamp');
    },
    async save(message) {
        const id = message.id || crypto.randomUUID();
        const msg = {
            id,
            conversationId: message.conversationId,
            role: message.role, // 'user' or 'assistant'
            content: message.content,
            timestamp: message.timestamp || Date.now()
        };
        await db.chat_messages.put(msg);
        // Update conversation's updatedAt
        await ConversationDAO.touch(message.conversationId);
        return msg;
    },
    async clearByConversationId(conversationId) {
        await db.chat_messages.where('conversationId').equals(conversationId).delete();
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
