/**
 * AI Service Module
 * Connects to local Ollama instance for intelligence features
 */

const AIService = { // Fallback if modules used
    endpoint: '/api/generate',
    model: 'llama2:7b',


    /**
     * Check if Ollama is available
     */
    async checkHealth() {
        try {
            const res = await fetch('http://localhost:11434/api/tags');
            return res.ok;
        } catch (e) {
            console.warn('Ollama not reachable:', e);
            return false;
        }
    },

    /**
     * Generate tags for a note content
     * @param {string} content 
     * @returns {Promise<string[]>} List of tags
     */
    async generateTags(content) {
        if (!content || content.length < 10) return [];

        const prompt = `Analyze the following note and generate 3-5 relevant, single-word tags. Return ONLY the tags separated by commas. Do not explain.
        
        Note:
        ${content.substring(0, 1000)}
        
        Tags:`;

        try {
            const result = await this.queryOllama(prompt);
            // Parse result: "tech, ideas, web" -> ['tech', 'ideas', 'web']
            return result.split(',')
                .map(t => t.trim().toLowerCase().replace(/[^a-z0-9\-]/g, ''))
                .filter(t => t.length > 0);
        } catch (e) {
            console.error('AI Tagging failed:', e);
            throw e;
        }
    },

    /**
     * Generate a short summary for the note
     * @param {string} content 
     * @returns {Promise<string>} Summary text
     */
    async summarize(content) {
        if (!content) return '';
        const prompt = `Summarize the following note in one concise sentence:
        
        ${content.substring(0, 2000)}`;

        try {
            return await this.queryOllama(prompt);
        } catch (e) {
            console.error('AI Summarization failed:', e);
            return '';
        }
    },

    /**
     * Find semantically related notes
     * @param {string} content - Current note content
     * @param {Array} notesList - List of {id, title, tags}
     * @returns {Promise<string[]>} List of related Note IDs
     */
    async findRelatedNotes(content, notesList) {
        if (!content || !notesList || notesList.length === 0) return [];

        // Prepare context (limit to avoid token overflow)
        // We take Title + Tags.
        const context = notesList.slice(0, 50).map(n =>
            `ID: ${n.id} | Title: ${n.title} | Tags: ${n.tags.join(', ')}`
        ).join('\n');

        const prompt = `Task: Identify up to 3 existing notes that are strongly related to the new note below.
        
        New Note Content:
        "${content.substring(0, 500)}..."
        
        Existing Notes:
        ${context}
        
        Return ONLY a JSON array of the related Note IDs. No text.
        Example: ["123", "456"]`;

        try {
            const result = await this.queryOllama(prompt);
            // Attempt to parse JSON
            const jsonMatch = result.match(/\[.*\]/s);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return [];
        } catch (e) {
            console.error('AI Linking failed:', e);
            return [];
        }
    },

    /**
     * Initialize Service
     */
    async init() {
        try {
            const res = await fetch('/api/default-model');
            if (res.ok) {
                const data = await res.json();
                if (data.model) {
                    this.model = data.model;
                    console.log(`AIService: Initialized with server model: ${this.model}`);
                }
            }
        } catch (e) {
            console.warn('Failed to fetch default model from server:', e);
        }
    },

    /**
     * Set the AI model to use
     * @param {string} modelName 
     */
    setModel(modelName) {
        if (modelName) {
            this.model = modelName;
            console.log(`AIService: Model set to ${modelName}`);
        }
    },

    /**
     * Get list of available models from Ollama
     * @returns {Promise<string[]>} List of model names
     */
    async getModels() {
        try {
            const res = await fetch('http://localhost:11434/api/tags');
            if (!res.ok) throw new Error('Failed to fetch models');
            const data = await res.json();
            return data.models.map(m => m.name);
        } catch (e) {
            console.warn('Could not fetch models:', e);
            return [];
        }
    },

    // --- RAG & Embeddings ---

    async generateEmbedding(text) {
        // The original code does not have `this.init()` or `this.baseUrl`.
        // Assuming `this.endpoint` is the base URL for Ollama API calls.
        // And `this.model` is already set or will be used as a fallback.

        let embeddingModel = 'nomic-embed-text';

        try {
            const response = await fetch(`${this.endpoint.replace('/api/generate', '')}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: embeddingModel,
                    prompt: text
                })
            });

            if (!response.ok) {
                // Fallback to active chat model (might work for some models like llama3)
                console.warn(`Embedding failed with ${embeddingModel}, trying ${this.model}`);
                const response2 = await fetch(`${this.endpoint.replace('/api/generate', '')}/api/embeddings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: this.model,
                        prompt: text
                    })
                });
                if (!response2.ok) throw new Error('Failed to generate embedding');
                const data2 = await response2.json();
                return data2.embedding;
            }

            const data = await response.json();
            return data.embedding;
        } catch (e) {
            console.error("Embedding Error:", e);
            throw e;
        }
    },

    async chat(messages) {
        // The original code does not have `this.init()` or `this.baseUrl`.
        // Assuming `this.endpoint` is the base URL for Ollama API calls.

        try {
            const response = await fetch(`${this.endpoint.replace('/api/generate', '')}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages,
                    stream: false // For now, no streaming to simplify UI
                })
            });

            if (!response.ok) throw new Error('Chat failed');
            const data = await response.json();
            return data.message.content; // Return just the text content
        } catch (e) {
            console.error("Chat Error:", e);
            throw e;
        }
    },

    /**
     * Internal helper to call Ollama
     */
    async queryOllama(prompt) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: prompt,
                    stream: false
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);

            const data = await response.json();
            return data.response.trim();
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') throw new Error('Request timed out');
            throw e;
        }
    }
};
window.AIService = AIService;
// Initialize
setTimeout(() => AIService.init(), 1000); // Small delay to ensure server is ready? No, server is always ready. Just nice to detach.
