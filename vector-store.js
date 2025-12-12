/**
 * VectorStore - Local Vector Database using Dexie + In-Memory Search
 */
const VectorStore = {
    // Configuration
    BATCH_SIZE: 1,

    /**
     * Generate and save embedding for a note
     */
    async indexNote(note) {
        if (!note || !note.body) return;

        // Check if embedding exists and is fresh
        const existing = await db.embeddings.get(note.id);
        if (existing && existing.updatedAt >= note.updatedAt) {
            return; // Already up to date
        }

        try {
            updateSyncStatus('Generating embedding...', false);
            const vector = await AIService.generateEmbedding(note.title + "\n" + note.body);

            await db.embeddings.put({
                noteId: note.id,
                updatedAt: Date.now(),
                vector: vector
            });
            updateSyncStatus('Indexed for search!');
        } catch (e) {
            console.error('Indexing failed:', e);
            // Don't show error toast on every failure to avoid annoyance
        }
    },

    /**
     * Semantic Search
     * @param {string} query 
     * @param {number} k 
     * @returns {Array<{noteId: string, score: number}>}
     */
    async search(query, k = 5) {
        updateSyncStatus('Searching...', false);

        // 1. Generate Query Vector
        const queryVector = await AIService.generateEmbedding(query);

        // 2. Fetch all vectors (Fast for <10k items)
        // Optimization: Dexie.keys() first? No, we need vectors.
        const allEmbeddings = await db.embeddings.toArray();
        if (allEmbeddings.length === 0) return [];

        // 3. Compute Similarities
        const results = allEmbeddings.map(record => ({
            noteId: record.noteId,
            score: this.cosineSimilarity(queryVector, record.vector)
        }));

        // 4. Sort and Slice
        results.sort((a, b) => b.score - a.score);

        updateSyncStatus('Search complete');
        return results.slice(0, k);
    },

    /**
     * Cosine Similarity between two vectors
     */
    cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            magnitudeA += vecA[i] * vecA[i];
            magnitudeB += vecB[i] * vecB[i];
        }

        magnitudeA = Math.sqrt(magnitudeA);
        magnitudeB = Math.sqrt(magnitudeB);

        if (magnitudeA === 0 || magnitudeB === 0) return 0;
        return dotProduct / (magnitudeA * magnitudeB);
    }
};
window.VectorStore = VectorStore;
