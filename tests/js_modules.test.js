const assert = require('assert');

const { createRenderUtils } = require('../render-utils.js');
const { createChatRagService } = require('../chat-rag-service.js');
const { createChatUIService } = require('../chat-ui.js');
const { createNoteListService } = require('../note-list.js');
const { createFileSyncService } = require('../notes-reliability.js');
const ApiContracts = require('../api-contracts.js');

(async function run() {
    // Render utils: pure escaping + marked passthrough
    const renderUtils = createRenderUtils({
        marked: { parse: (v) => `<p>${v}</p>` },
        DOMPurify: null,
        mermaid: null,
        renderMathInElement: null,
        AttachmentDAO: null
    });

    assert.equal(renderUtils.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(renderUtils.safeMarkedParse('hello'), '<p>hello</p>');

    // Chat RAG: explicit mention path should be preferred over vector search
    let vectorCalled = false;
    const chatService = createChatRagService({
        VectorStore: {
            async retrieveRelevantChunks() {
                vectorCalled = true;
                return { chunks: [], citations: [] };
            }
        },
        AITools: {
            getSystemPromptAddon() {
                return '\nTOOLS_ADDON';
            }
        }
    });

    const notes = [
        { id: '1', title: 'Roadmap', body: 'Quarterly milestones and owners.' },
        { id: '2', title: 'Infra', body: 'Service topology details.' }
    ];

    const prompt = await chatService.buildPrompt({
        message: 'Summarize @Roadmap and include blockers',
        notes,
        activeNoteId: null
    });

    assert.equal(vectorCalled, false);
    assert.ok(prompt.systemPrompt.includes('Roadmap#full'));
    assert.ok(prompt.systemPrompt.includes('TOOLS_ADDON'));

    const loopResult = await chatService.runAgentLoop({
        systemPrompt: 'System prompt',
        history: [{ role: 'user', content: 'hello' }],
        aiChat: async (messages) => {
            const hasToolResult = messages.some((m) => typeof m.content === 'string' && m.content.includes('Tool Result:'));
            if (!hasToolResult) {
                return '{"tool":"search_notes","arguments":{"query":"hello"}}';
            }
            return 'Final assistant response';
        },
        executeTool: async (toolCall) => {
            assert.equal(toolCall.tool, 'search_notes');
            return '[]';
        },
        onToolExecution: (toolCall) => {
            assert.equal(toolCall.tool, 'search_notes');
        },
        maxTurns: 3
    });
    assert.equal(loopResult.finalResponse, 'Final assistant response');

    // Chat UI: extracted message rendering + state helpers
    const fakeDoc = {
        getElementById() { return null; }
    };

    const chatUI = createChatUIService({
        documentRef: fakeDoc,
        escapeHtml: renderUtils.escapeHtml,
        safeMarkedParse: renderUtils.safeMarkedParse
    });

    const state = chatUI.createChatState();
    assert.ok(Array.isArray(state.history));
    assert.equal(state.activeConversationId, null);

    const thinkingHtml = chatUI.createMessageHTML('ai', '<img src=x onerror=alert(1)>', true);
    assert.ok(thinkingHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));

    // Note list: filtering and nested tag rendering are extracted and testable
    const noteList = createNoteListService({ escapeHtml: renderUtils.escapeHtml });
    const sampleNotes = [
        { id: 'n1', title: 'Alpha', body: 'Project planning', tags: ['work/main'], pinned: true, folderId: 'f1' },
        { id: 'n2', title: 'Beta', body: 'Personal errands', tags: ['home'], pinned: false, folderId: 'f2' }
    ];

    const pinnedInFolder = noteList.filterNotes(sampleNotes, {
        filter: 'pinned',
        searchQuery: 'work',
        activeFolderId: 'f1',
        includeTagsInSearch: true
    });
    assert.equal(pinnedInFolder.length, 1);
    assert.equal(pinnedInFolder[0].id, 'n1');

    const noteListHtml = noteList.renderNoteListHtml(pinnedInFolder, {
        activeNoteId: 'n1',
        nestedTagRendering: true
    });
    assert.ok(noteListHtml.includes('opacity-50'));
    assert.ok(noteListHtml.includes('work/'));

    // API contracts: request and response validation guards
    assert.equal(ApiContracts.API_SCHEMA_VERSION, 'v1');
    assert.doesNotThrow(() => {
        ApiContracts.validateRequest('/api/generate', { model: 'x', prompt: 'hello', stream: false });
    });
    assert.throws(() => {
        ApiContracts.validateRequest('/api/chat', { messages: [] });
    });
    assert.doesNotThrow(() => {
        ApiContracts.validateResponse('/api/default-model', { model: 'x', source: 'server', schemaVersion: 'v1' });
    });
    assert.throws(() => {
        ApiContracts.validateResponse('/api/default-model', { model: 'x', source: 'server', schemaVersion: 'v2' });
    });

    // FileSync service: ensure contracts are applied to non-AI API consumers
    const savedNotes = [];
    const fileSync = createFileSyncService({
        NoteDAO: {
            async getAll() {
                return [{ id: 'sync-1', title: 'Sync', body: 'Body' }];
            },
            async save(note) {
                savedNotes.push(note);
            }
        },
        fetchImpl: async (url, opts) => {
            if (url === '/api/file-notes/sync') {
                return {
                    ok: true,
                    async json() {
                        return { ok: true, written: 1, files: ['sync-1__sync.md'], schemaVersion: 'v1' };
                    }
                };
            }

            if (url === '/api/file-notes/load') {
                return {
                    ok: true,
                    async json() {
                        return {
                            notes: [{ id: 'loaded-1', title: 'Loaded', body: 'From FS' }],
                            count: 1,
                            schemaVersion: 'v1'
                        };
                    }
                };
            }

            throw new Error('Unexpected fetch call: ' + url + ' opts=' + JSON.stringify(opts || {}));
        },
        ApiContracts
    });

    await fileSync.syncNotesToFilesystem();

    const hydrateService = createFileSyncService({
        NoteDAO: {
            async getAll() {
                return [];
            },
            async save(note) {
                savedNotes.push(note);
            }
        },
        fetchImpl: async () => ({
            ok: true,
            async json() {
                return {
                    notes: [{ id: 'loaded-1', title: 'Loaded', body: 'From FS' }],
                    count: 1,
                    schemaVersion: 'v1'
                };
            }
        }),
        ApiContracts
    });

    await hydrateService.hydrateFromFilesystemIfNeeded();
    assert.equal(savedNotes.length > 0, true);

    console.log('JS module tests passed');
})();
