/**
 * VectorStore - Indexed vector retrieval + hybrid chunk retrieval for RAG.
 */
const VectorStore = {
    HASH_BITS: 24,
    MAX_CANDIDATES: 300,
    QUERY_CACHE_TTL_MS: 5 * 60 * 1000,

    _chunkText(text, targetSize = 420, overlap = 80) {
        if (!text) return [];
        const compact = text.replace(/\s+/g, ' ').trim();
        if (!compact) return [];

        const chunks = [];
        let start = 0;
        while (start < compact.length) {
            const end = Math.min(start + targetSize, compact.length);
            const piece = compact.slice(start, end).trim();
            if (piece) chunks.push(piece);
            if (end >= compact.length) break;
            start = Math.max(end - overlap, start + 1);
        }
        return chunks;
    },

    _toKeyHash(str) {
        // Fast deterministic hash for cache keying.
        let hash = 2166136261;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return (hash >>> 0).toString(16);
    },

    _vectorBucketKey(vector) {
        if (!Array.isArray(vector) || vector.length === 0) return 'bucket:empty';
        const bits = Math.min(this.HASH_BITS, vector.length);
        let key = 'bucket:';
        for (let i = 0; i < bits; i++) {
            key += (vector[i] >= 0 ? '1' : '0');
        }
        return key;
    },

    _neighborBucketKeys(bucketKey, limit = 6) {
        const raw = bucketKey.replace('bucket:', '');
        const neighbors = [];
        for (let i = 0; i < raw.length && neighbors.length < limit; i++) {
            const flipped = raw.substring(0, i) + (raw[i] === '1' ? '0' : '1') + raw.substring(i + 1);
            neighbors.push('bucket:' + flipped);
        }
        return neighbors;
    },

    async _getCachedQueryEmbedding(query) {
        const queryHash = this._toKeyHash(query.trim().toLowerCase());
        const record = await db.rag_cache.get(queryHash);
        if (record && (Date.now() - record.updatedAt) < this.QUERY_CACHE_TTL_MS) {
            return { vector: record.vector, queryHash };
        }
        return { vector: null, queryHash };
    },

    async _setCachedQueryEmbedding(queryHash, vector) {
        await db.rag_cache.put({ queryHash, vector, updatedAt: Date.now() });
    },

    async indexNote(note) {
        if (!note || !note.body) return;

        const existing = await db.embeddings.get(note.id);
        if (existing && existing.updatedAt >= note.updatedAt) {
            return;
        }

        try {
            updateSyncStatus('Generating embedding...', false);
            const vector = await AIService.generateEmbedding(note.title + '\n' + note.body);
            if (!Array.isArray(vector) || vector.length === 0) {
                return;
            }
            const bucketKey = this._vectorBucketKey(vector);

            await db.transaction('rw', db.embeddings, db.embedding_buckets, async () => {
                await db.embeddings.put({
                    noteId: note.id,
                    updatedAt: Date.now(),
                    vector,
                });

                await db.embedding_buckets.where('noteId').equals(note.id).delete();
                await db.embedding_buckets.add({
                    bucketKey,
                    noteId: note.id,
                    updatedAt: Date.now(),
                });
            });

            updateSyncStatus('Indexed for search!');
        } catch (e) {
            console.error('Indexing failed:', e);
        }
    },

    cosineSimilarity(vecA, vecB) {
        if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecB.length === 0) {
            return 0;
        }

        const len = Math.min(vecA.length, vecB.length);
        let dot = 0;
        let magA = 0;
        let magB = 0;

        for (let i = 0; i < len; i++) {
            dot += vecA[i] * vecB[i];
            magA += vecA[i] * vecA[i];
            magB += vecB[i] * vecB[i];
        }

        if (magA === 0 || magB === 0) return 0;
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    },

    async _getCandidateNoteIds(queryVector) {
        const bucketKey = this._vectorBucketKey(queryVector);
        const candidateIds = new Set();

        const primary = await db.embedding_buckets.where('bucketKey').equals(bucketKey).limit(this.MAX_CANDIDATES).toArray();
        primary.forEach((x) => candidateIds.add(x.noteId));

        if (candidateIds.size < 24) {
            const neighbors = this._neighborBucketKeys(bucketKey, 6);
            for (const key of neighbors) {
                const matches = await db.embedding_buckets.where('bucketKey').equals(key).limit(40).toArray();
                matches.forEach((x) => candidateIds.add(x.noteId));
                if (candidateIds.size >= this.MAX_CANDIDATES) break;
            }
        }

        return Array.from(candidateIds);
    },

    async search(query, k = 5) {
        updateSyncStatus('Searching...', false);

        const q = (query || '').trim();
        if (!q) return [];

        const cached = await this._getCachedQueryEmbedding(q);
        let queryVector = cached.vector;
        if (!queryVector) {
            queryVector = await AIService.generateEmbedding(q);
            if (!Array.isArray(queryVector) || queryVector.length === 0) {
                updateSyncStatus('Search complete');
                return [];
            }
            await this._setCachedQueryEmbedding(cached.queryHash, queryVector);
        }

        let embeddings = [];
        const candidateIds = await this._getCandidateNoteIds(queryVector);

        if (candidateIds.length > 0) {
            const rows = await db.embeddings.bulkGet(candidateIds);
            embeddings = rows.filter(Boolean);
        }

        if (embeddings.length < Math.min(k, 5)) {
            // Fallback for sparse/new indexes.
            embeddings = await db.embeddings.toArray();
        }

        const scored = embeddings.map((row) => ({
            noteId: row.noteId,
            score: this.cosineSimilarity(queryVector, row.vector),
        }));

        scored.sort((a, b) => b.score - a.score);
        updateSyncStatus('Search complete');
        return scored.slice(0, k);
    },

    _keywordNoteScore(query, note) {
        const q = query.trim().toLowerCase();
        if (!q) return 0;

        const title = (note.title || '').toLowerCase();
        const body = (note.body || '').toLowerCase();
        const tags = (note.tags || []).join(' ').toLowerCase();

        let score = 0;
        if (title.includes(q)) score += 2;
        if (tags.includes(q)) score += 1;
        if (body.includes(q)) score += 1;

        return score;
    },

    async retrieveRelevantChunks(query, opts = {}) {
        const topK = opts.topK || 8;
        const maxNotes = opts.maxNotes || 6;
        const chunksPerNote = opts.chunksPerNote || 3;

        const semantic = await this.search(query, 12);
        const semanticMap = new Map(semantic.map((x) => [x.noteId, x.score]));

        let keywordCandidates = [];
        if (window.NoteDAO) {
            const keywordNotes = await NoteDAO.search(query);
            keywordCandidates = keywordNotes
                .map((n) => ({ note: n, score: this._keywordNoteScore(query, n) }))
                .filter((x) => x.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 10)
                .map((x) => x.note.id);
        }

        const noteIds = new Set();
        semantic.slice(0, maxNotes).forEach((x) => noteIds.add(x.noteId));
        keywordCandidates.forEach((id) => noteIds.add(id));

        const notes = await Promise.all(Array.from(noteIds).map((id) => NoteDAO.get(id)));
        const validNotes = notes.filter(Boolean);

        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const allChunks = [];

        for (const note of validNotes) {
            const baseSemantic = semanticMap.get(note.id) || 0;
            const chunks = this._chunkText(note.body || '');
            if (chunks.length === 0) continue;

            let emitted = 0;
            for (let i = 0; i < chunks.length && emitted < chunksPerNote; i++) {
                const chunk = chunks[i];
                const lower = chunk.toLowerCase();
                let keywordHit = 0;
                for (const t of terms) {
                    if (lower.includes(t)) keywordHit += 1;
                }
                if (terms.length > 0 && keywordHit === 0 && baseSemantic < 0.2) {
                    continue;
                }

                const hybridScore = (baseSemantic * 0.7) + (keywordHit / Math.max(terms.length, 1)) * 0.3;
                allChunks.push({
                    noteId: note.id,
                    noteTitle: note.title || 'Untitled',
                    chunk,
                    score: hybridScore,
                    citation: `${note.title || 'Untitled'}#chunk-${i + 1}`,
                });
                emitted += 1;
            }
        }

        allChunks.sort((a, b) => b.score - a.score);
        const topChunks = allChunks.slice(0, topK);

        return {
            query,
            chunks: topChunks,
            citations: topChunks.map((x) => ({ noteId: x.noteId, title: x.noteTitle, ref: x.citation })),
        };
    },
};

window.VectorStore = VectorStore;
