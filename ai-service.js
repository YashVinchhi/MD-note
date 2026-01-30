


    const AIService = {
        // Default endpoint: use the web app's origin proxy (/api/* forwarded by server.py)
        endpoint: (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : 'http://localhost:50001') + '/api/generate',
        model: null,
        /**
         * Generate a diagram (Mermaid or SVG) from plain text using Ollama
         * @param {string} text - The user-selected text to convert into a diagram
         * @param {string} [format] - 'mermaid' (default) or 'svg'
         * @returns {Promise<string>} Mermaid code or SVG string
         */
        async generateDiagramFromText(text, format = 'mermaid') {
            if (!text || text.length < 5) throw new Error('Please provide more text to generate a diagram.');
            let prompt;
            if (format === 'svg') {
                prompt = `Convert the following description into an SVG diagram. Return ONLY the SVG code, no explanation.\n\nDescription:\n${text}\n\nSVG:`;
            } else {
                prompt = `Convert the following description into a ${format} diagram. Return ONLY the ${format} code, no explanation.\n\nDescription:\n${text}\n\n${format}:`;
            }
            try {
                const result = await this.queryOllama(prompt);
                // Return only the code block (strip markdown if present)
                const code = result.replace(/^```[a-zA-Z]*\n?|```$/g, '').trim();
                return code;
            } catch (e) {
                console.error('AI Diagram generation failed:', e);
                throw e;
            }
        },

        /**
         * Check if Ollama is available
         */
        async checkHealth() {
            try {
                const base = (this.endpoint || '').replace('/api/generate', '') || (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : 'http://localhost:50001');
                const res = await fetch(base + '/api/tags');
                return res.ok;
            } catch (e) {
                console.warn('Ollama not reachable (via proxy):', e);
                return false;
            }
        },

        /**
         * Suggest a folder/category for a note based on its content and tags
         * @param {string} content - The note content (title + body)
         * @param {string[]} tags - The note's tags
         * @param {string[]} existingFolders - List of existing folder names
         * @returns {Promise<string>} Suggested folder name
         */
        async generateFolderSuggestion(content, tags = [], existingFolders = []) {
            if (!content || content.length < 10) return '';
            const prompt = `You are an intelligent note organizer. Given the following note and a list of existing folders, suggest the single most relevant folder name from the list, or suggest a new folder if none fit. Return ONLY the folder name, no explanation.\n\nNote Content:\n${content.substring(0, 1000)}\nTags: ${tags.join(', ')}\n\nExisting Folders:\n${existingFolders.join(', ') || 'None'}\n\nFolder:`;
            try {
                const result = await this.queryOllama(prompt);
                // Return only the first line, trimmed
                return result.split('\n')[0].trim();
            } catch (e) {
                console.error('AI Folder Suggestion failed:', e);
                return '';
            }
        },

        /**
         * Generate tags for a note content
         * @param {string} content 
         * @returns {Promise<string[]>} List of tags
         */
        async generateTags(content) {
            if (!content || content.length < 10) return [];

            const prompt = `Analyze the following note and generate 3-5 relevant, single-word tags. Return ONLY the tags separated by commas. Do not explain.\n        
            Note:\n            ${content.substring(0, 1000)}\n        \n            Tags:`;

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
            const prompt = `Summarize the following note in one concise sentence:\n        \n            ${content.substring(0, 2000)}`;

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

            const prompt = `Task: Identify up to 3 existing notes that are strongly related to the new note below.\n        \n            New Note Content:\n            "${content.substring(0, 500)}..."\n        \n            Existing Notes:\n            ${context}\n        \n            Return ONLY a JSON array of the related Note IDs. No text.\n            Example: ["123", "456"]`;

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

            // Ensure endpoint/baseUrl are set
            if (!this.endpoint) {
                this.endpoint = (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : 'http://localhost:50001') + '/api/generate';
            }
            this.baseUrl = (this.endpoint || '').replace('/api/generate', '');
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
                const base = (this.endpoint || '').replace('/api/generate', '') || (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : 'http://localhost:50001');
                const res = await fetch(base + '/api/tags');
                if (!res.ok) {
                    const body = await res.text().catch(() => '');
                    throw new Error(`Failed to fetch models: ${res.status} ${res.statusText} - ${body}`);
                }
                const data = await res.json();
                return (data.models || []).map(m => m.name);
            } catch (e) {
                console.warn('Could not fetch models (via proxy):', e);
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
                const base = (this.endpoint || '').replace('/api/generate', '') || (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : 'http://localhost:50001');
                const response = await fetch(base + '/api/embeddings', {
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
                    const response2 = await fetch(base + '/api/embeddings', {
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
                const base = (this.endpoint || '').replace('/api/generate', '') || (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : 'http://localhost:50001');
                const response = await fetch(base + '/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: this.model,
                        messages: messages,
                        stream: false // For now, no streaming to simplify UI
                    })
                });

                if (!response.ok) {
                    const body = await response.text().catch(() => '');
                    throw new Error(`Chat failed: ${response.status} ${response.statusText} - ${body}`);
                }
                const data = await response.json();
                return data.message && data.message.content ? data.message.content : (data.response || ''); // Return just the text content
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
                // Ensure endpoint is set
                if (!this.endpoint) {
                    this.endpoint = (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : 'http://localhost:50001') + '/api/generate';
                }

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

                if (!response.ok) {
                    // Include response body for easier debugging
                    const body = await response.text().catch(() => '');
                    throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${body}`);
                }

                const data = await response.json();
                // Support different response shapes
                if (data.response) return (typeof data.response === 'string') ? data.response.trim() : JSON.stringify(data.response);
                if (data.message && data.message.content) return data.message.content.trim();
                if (data.output && typeof data.output === 'string') return data.output.trim();
                return JSON.stringify(data);
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
