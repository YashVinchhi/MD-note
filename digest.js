// filepath: d:\MD-Notes\digest.js

/**
 * DigestManager
 * - Collects recent notes
 * - Calls AIService to generate a JSON digest
 * - Renders a modal with the summary, notable changes, suggested reviews and action items
 */

window.DigestManager = (function () {
    function daysAgoTimestamp(days) {
        return Date.now() - days * 24 * 60 * 60 * 1000;
    }

    function truncate(str, n = 300) {
        if (!str) return '';
        return str.length <= n ? str : str.substring(0, n) + '...';
    }

    async function collectRecentNotes(days = 7, limit = 10) {
        const all = await NoteDAO.getAll();
        const cutoff = daysAgoTimestamp(days);
        const recent = all.filter(n => n.updatedAt && n.updatedAt >= cutoff);
        recent.sort((a, b) => b.updatedAt - a.updatedAt);
        return recent.slice(0, limit).map(n => ({
            id: n.id,
            title: n.title || 'Untitled',
            tags: n.tags || [],
            updatedAt: n.updatedAt || 0,
            excerpt: truncate((n.body || '').replace(/\n+/g, ' '), 500)
        }));
    }

    function buildPrompt(notes, periodLabel) {
        if (!notes || notes.length === 0) {
            return `You are an assistant that produces concise digests. The user has no notes updated in the last ${periodLabel}. Return a short JSON object:\n{ "summary": "...", "notable_changes": [], "suggested_reviews": [], "action_items": [] }`;
        }

        const notesText = notes.map((n, i) => `- ${i + 1}. Title: ${n.title}\n  Tags: ${n.tags.join(', ') || 'None'}\n  UpdatedAt: ${new Date(n.updatedAt).toLocaleString()}\n  Excerpt: ${n.excerpt}`).join('\n\n');

        return `You are an assistant that produces concise, actionable digests from a list of user notes.\n\nPeriod: ${periodLabel}\nNotes:\n${notesText}\n\nPlease return ONLY a JSON object with the following keys:\n- summary: One short paragraph (2-3 sentences) summarizing the themes across these notes.\n- notable_changes: An array of 3-6 short bullet points describing important updates or changes found in the notes (title + brief reason).\n- suggested_reviews: An array of 3 suggested notes (by title) the user should review this period, with a one-line reason each.\n- action_items: Up to 5 short, specific action items the user can take next (e.g., follow up, consolidate notes, schedule a review).\n\nMake results concise. Example output format:\n{\n  "summary": "...",\n  "notable_changes": ["Title A - ...", "Title B - ..."],\n  "suggested_reviews": [{"title":"Title B","reason":"..."}],\n  "action_items": ["..."]\n}\n\nBe careful to output valid JSON only.`;
    }

    async function callAIForDigest(prompt) {
        // Use AIService.queryOllama which returns text
        try {
            const raw = await AIService.queryOllama(prompt);

            // Try to extract a JSON object by finding outermost braces
            const obj = extractJsonObject(raw);
            if (obj) return obj;

            // Try to extract a top-level array
            const arr = extractJsonArray(raw);
            if (arr) return arr;

            return { raw };
        } catch (e) {
            console.error('AI call for digest failed:', e);
            throw e;
        }
    }

    // Safely extract a JSON object substring by locating the first '{' and the matching '}'
    function extractJsonObject(str) {
        const first = str.indexOf('{');
        const last = str.lastIndexOf('}');
        if (first === -1 || last === -1 || last <= first) return null;
        const sub = str.substring(first, last + 1);
        try { return JSON.parse(sub); } catch (e) { return null; }
    }

    function extractJsonArray(str) {
        const first = str.indexOf('[');
        const last = str.lastIndexOf(']');
        if (first === -1 || last === -1 || last <= first) return null;
        const sub = str.substring(first, last + 1);
        try { return JSON.parse(sub); } catch (e) { return null; }
    }

    function showModalContent(contentHtml) {
        const modal = document.getElementById('digest-modal');
        if (!modal) return;
        const body = modal.querySelector('.digest-body');
        if (!body) return;
        body.innerHTML = contentHtml;
        modal.classList.remove('hidden');
    }

    function closeModal() {
        const modal = document.getElementById('digest-modal');
        if (!modal) return;
        modal.classList.add('hidden');
    }

    function renderDigestToHtml(resultObj) {
        if (!resultObj) return '<p>No digest available.</p>';
        if (resultObj.raw) {
            return `<pre class="whitespace-pre-wrap">${escapeHtml(resultObj.raw)}</pre>`;
        }

        const summary = resultObj.summary || '';
        const notable = resultObj.notable_changes || [];
        const reviews = resultObj.suggested_reviews || [];
        const actions = resultObj.action_items || [];

        return `
            <div class="p-6 max-h-[60vh] overflow-y-auto">
                <h3 class="text-lg font-semibold mb-2">Summary</h3>
                <p class="mb-4">${escapeHtml(summary)}</p>

                <h4 class="text-md font-medium mb-2">Notable Changes</h4>
                <ul class="list-disc ml-5 mb-4">
                    ${notable.map(n => `<li>${escapeHtml(n)}</li>`).join('')}
                </ul>

                <h4 class="text-md font-medium mb-2">Suggested Reviews</h4>
                <ul class="list-disc ml-5 mb-4">
                    ${reviews.map(r => `<li><strong>${escapeHtml(r.title || r)}</strong>${r.reason ? ' — ' + escapeHtml(r.reason) : ''}</li>`).join('')}
                </ul>

                <h4 class="text-md font-medium mb-2">Action Items</h4>
                <ol class="list-decimal ml-5 mb-2">
                    ${actions.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
                </ol>
            </div>
            <div class="px-6 py-3 border-t flex justify-end gap-2">
                <button onclick="DigestManager.close()" class="px-4 py-2 rounded bg-gray-100 dark:bg-gray-800">Close</button>
            </div>
        `;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async function generateDigest(period = 'weekly') {
        const days = period === 'daily' ? 1 : 7;
        const periodLabel = period === 'daily' ? 'last 24 hours' : 'last 7 days';
        const notes = await collectRecentNotes(days, 12);

        const prompt = buildPrompt(notes, periodLabel);

        try {
            return await callAIForDigest(prompt);
        } catch (e) {
            // On failure, fallback to simple aggregated summary
            const titles = notes.map(n => n.title).slice(0, 5).join(', ') || 'No recent notes';
            return {
                summary: `Couldn't contact AI. Recent notes: ${titles}`,
                notable_changes: [],
                suggested_reviews: notes.slice(0,3).map(n => ({ title: n.title, reason: 'Recently updated' })),
                action_items: []
            };
        }
    }

    async function openDigest(period = 'weekly') {
        const modal = document.getElementById('digest-modal');
        if (!modal) return;
        showModalContent('<div class="p-6">Generating digest&hellip; <span id="digest-spinner">⏳</span></div>');
        try {
            const result = await generateDigest(period);
            const html = renderDigestToHtml(result);
            showModalContent(html);
        } catch (e) {
            showModalContent('<div class="p-6">Failed to generate digest. Check console for details.</div>');
        }
    }

    // Wire button on DOMContentLoaded
    function wire() {
        document.addEventListener('DOMContentLoaded', () => {
            const btn = document.getElementById('digest-btn');
            if (btn) btn.addEventListener('click', () => openDigest('weekly'));

            const dailyBtn = document.getElementById('digest-daily-btn');
            if (dailyBtn) dailyBtn.addEventListener('click', () => openDigest('daily'));

            const closeBtns = document.querySelectorAll('.digest-close');
            closeBtns.forEach(b => b.addEventListener('click', closeModal));
        });
    }

    wire();

    return {
        open: openDigest,
        generate: generateDigest,
        close: closeModal
    };
})();
