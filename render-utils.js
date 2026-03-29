(function (global) {
    function createRenderUtils(deps) {
        const markedLib = deps.marked;
        const domPurify = deps.DOMPurify;
        const mermaidLib = deps.mermaid;
        const renderMath = deps.renderMathInElement;
        const AttachmentDAO = deps.AttachmentDAO;

        function escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function sanitizeHtml(html) {
            if (domPurify && typeof domPurify.sanitize === 'function') {
                return domPurify.sanitize(html, {
                    USE_PROFILES: { html: true },
                    ADD_ATTR: ['target', 'rel']
                });
            }
            return html;
        }

        function safeMarkedParse(markdownText) {
            if (!markedLib || typeof markedLib.parse !== 'function') {
                return escapeHtml(markdownText || '');
            }
            return sanitizeHtml(markedLib.parse(markdownText || ''));
        }

        async function renderMarkdownPreview() {
            const editor = global.document && global.document.getElementById('note-body');
            const preview = global.document && global.document.getElementById('note-preview');
            if (!editor || !preview || !markedLib) return;

            const content = editor.value;
            const renderer = new markedLib.Renderer();

            renderer.listitem = (item) => {
                let text;
                let task;
                let checked;

                if (typeof item === 'object' && item !== null && 'text' in item) {
                    text = item.text;
                    task = item.task;
                    checked = item.checked;
                } else {
                    text = arguments[0];
                    task = arguments[1];
                    checked = arguments[2];
                }

                if (task) {
                    return `<li style="list-style: none;">
                        <label class="flex items-start gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 p-1 -ml-2 rounded">
                            <input type="checkbox" ${checked ? 'checked' : ''}
                                class="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 task-checkbox">
                            <span>${text}</span>
                        </label>
                    </li>`;
                }
                return `<li>${text}</li>`;
            };

            let html = sanitizeHtml(markedLib.parse(content, { renderer }));
            const attachmentRegex = /src="attachment:([^"]+)"/g;
            let match;
            const replacements = [];

            while ((match = attachmentRegex.exec(html)) !== null) {
                replacements.push({ fullMatch: match[0], id: match[1] });
            }

            if (AttachmentDAO) {
                for (const item of replacements) {
                    const record = await AttachmentDAO.get(item.id);
                    if (record && record.blob) {
                        const url = URL.createObjectURL(record.blob);
                        html = html.replace(item.fullMatch, `src="${url}" class="max-w-full rounded-lg shadow-sm my-2"`);
                    } else {
                        html = html.replace(item.fullMatch, 'src="" alt="Image not found"');
                    }
                }
            }

            preview.innerHTML = html;

            if (mermaidLib) {
                setTimeout(() => {
                    const mermaidBlocks = preview.querySelectorAll('code.language-mermaid');
                    mermaidBlocks.forEach((block) => {
                        const div = global.document.createElement('div');
                        div.className = 'mermaid';
                        div.textContent = block.textContent;
                        block.parentElement.replaceWith(div);
                    });
                    mermaidLib.run({ nodes: preview.querySelectorAll('.mermaid') });
                }, 0);
            }

            if (renderMath) {
                renderMath(preview, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '$', right: '$', display: false },
                        { left: '\\(', right: '\\)', display: false },
                        { left: '\\[', right: '\\]', display: true }
                    ],
                    throwOnError: false
                });
            }
        }

        return {
            escapeHtml,
            sanitizeHtml,
            safeMarkedParse,
            renderMarkdownPreview
        };
    }

    const api = {
        createRenderUtils
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (global && global.marked) {
        const utils = createRenderUtils({
            marked: global.marked,
            DOMPurify: global.DOMPurify,
            mermaid: global.mermaid,
            renderMathInElement: global.renderMathInElement,
            AttachmentDAO: global.AttachmentDAO
        });

        global.RenderUtils = utils;
        global.escapeHtml = utils.escapeHtml;
        global.sanitizeHtml = utils.sanitizeHtml;
        global.safeMarkedParse = utils.safeMarkedParse;
        global.renderMarkdownPreview = utils.renderMarkdownPreview;
    }
})(typeof window !== 'undefined' ? window : globalThis);
