/**
 * AI Service Module
 * Connects to local Ollama instance for intelligence features
 */

const AIService = {
    endpoint: 'http://localhost:11434/api/generate',
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
