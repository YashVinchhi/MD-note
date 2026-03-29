(function (global) {
    function createChatUIService(deps) {
        const doc = deps.documentRef;
        const escapeHtml = deps.escapeHtml;
        const safeMarkedParse = deps.safeMarkedParse;

        function createChatState() {
            return {
                history: [],
                activeConversationId: null,
                mentionQuery: null,
                isMentioning: false,
                mentionedNotes: new Set()
            };
        }

        function getWelcomeMessage() {
            return `
                <div class="flex gap-3">
                    <div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow shadow-indigo-500/30">
                        <span class="material-symbols-outlined text-white text-sm">smart_toy</span>
                    </div>
                    <div class="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-none px-4 py-2 text-sm text-gray-800 dark:text-gray-200 max-w-[85%]">
                        Hello! I can answer questions based on your notes. Type @ to mention specific notes.
                    </div>
                </div>
            `;
        }

        function createMessageHTML(role, text, isThinking) {
            const avatar = role === 'user'
                ? '<div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 text-white shadow shadow-indigo-500/30"><span class="material-symbols-outlined text-sm">person</span></div>'
                : '<div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 text-white shadow shadow-indigo-500/30"><span class="material-symbols-outlined text-sm">smart_toy</span></div>';
            const bubbleClass = role === 'user'
                ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl rounded-tr-none px-4 py-2.5 text-sm max-w-[85%] shadow shadow-indigo-500/30 prose prose-invert prose-p:my-1'
                : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-tl-none px-4 py-3 text-sm text-gray-800 dark:text-gray-200 max-w-[85%] shadow-sm prose dark:prose-invert prose-p:my-1';

            const content = isThinking ? escapeHtml(text) : safeMarkedParse(text);
            return `<div class="flex gap-3 ${role === 'user' ? 'flex-row-reverse' : ''}">${avatar}<div class="${bubbleClass} ${isThinking ? 'animate-pulse' : ''}">${content}</div></div>`;
        }

        function renderMessagesToContainer(containerId, messages) {
            const container = doc.getElementById(containerId);
            if (!container) return;
            if (!messages || messages.length === 0) {
                container.innerHTML = getWelcomeMessage();
                return;
            }
            container.innerHTML = messages.map((m) => createMessageHTML(m.role === 'user' ? 'user' : 'ai', m.content, false)).join('');
            container.scrollTop = container.scrollHeight;
        }

        function renderConversationList(containerId, conversations, activeConversationId) {
            const container = doc.getElementById(containerId);
            if (!container) return;
            container.innerHTML = (conversations || []).map((c) => `
                <button onclick="ChatManager.loadConversation('${c.id}')"
                    data-conv-id="${c.id}"
                    class="w-full text-left px-3 py-2.5 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-800 flex items-center gap-2 transition-colors ${c.id === activeConversationId ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}">
                    <span class="material-symbols-outlined text-[18px] opacity-60">chat_bubble</span>
                    <span class="truncate flex-1">${escapeHtml(c.title || 'Chat')}</span>
                </button>
            `).join('');
        }

        function highlightConversation(containerId, id) {
            const container = doc.getElementById(containerId);
            if (!container) return;
            container.querySelectorAll('button').forEach((btn) => {
                if (btn.dataset.convId === id) {
                    btn.classList.add('bg-blue-100', 'dark:bg-blue-900/30', 'text-blue-700', 'dark:text-blue-300');
                } else {
                    btn.classList.remove('bg-blue-100', 'dark:bg-blue-900/30', 'text-blue-700', 'dark:text-blue-300');
                }
            });
        }

        function addMessageToUI(containerId, role, text, isThinking) {
            const container = doc.getElementById(containerId);
            if (!container) return null;
            const div = doc.createElement('div');
            const id = 'msg-' + Date.now().toString();
            div.id = id;
            div.innerHTML = createMessageHTML(role, text, !!isThinking);
            div.innerHTML = div.firstElementChild.outerHTML;
            div.firstElementChild.id = id;
            container.appendChild(div.firstElementChild);
            container.scrollTop = container.scrollHeight;
            return id;
        }

        function updateMessageInUI(containerId, id, text) {
            const div = doc.getElementById(id);
            if (!div) return;
            const bubble = div.querySelector('div:last-child');
            if (!bubble) return;
            bubble.classList.remove('animate-pulse');
            bubble.innerHTML = safeMarkedParse(text);
            const container = doc.getElementById(containerId);
            if (container) container.scrollTop = container.scrollHeight;
        }

        function scrollToBottom(containerId) {
            const container = doc.getElementById(containerId);
            if (!container) return;
            container.scrollTop = container.scrollHeight;
        }

        function adjustInputHeight(el, maxHeight) {
            const cap = typeof maxHeight === 'number' ? maxHeight : 128;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, cap) + 'px';
        }

        return {
            createChatState,
            getWelcomeMessage,
            createMessageHTML,
            renderMessagesToContainer,
            renderConversationList,
            highlightConversation,
            addMessageToUI,
            updateMessageInUI,
            scrollToBottom,
            adjustInputHeight
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createChatUIService };
    }

    if (global && global.document) {
        global.ChatUIService = createChatUIService({
            documentRef: global.document,
            escapeHtml: global.escapeHtml || function (v) { return String(v || ''); },
            safeMarkedParse: global.safeMarkedParse || function (v) { return String(v || ''); }
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
