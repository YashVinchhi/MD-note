(function (global) {
    function createChatRagService(deps) {
        const vectorStore = deps.VectorStore;
        const aiTools = deps.AITools;

        function parseToolCall(responseText) {
            if (!responseText) return null;
            try {
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (!jsonMatch) return null;
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed && parsed.tool && parsed.arguments) {
                    return parsed;
                }
            } catch (e) {
                // Non-JSON output should be treated as final assistant response.
            }
            return null;
        }

        async function buildPrompt(options) {
            const message = (options.message || '').trim();
            const notes = Array.isArray(options.notes) ? options.notes : [];
            const activeNoteId = options.activeNoteId;

            let context = '';
            let citationBlock = '';

            const mentionMatches = [];
            const sortedNotes = [...notes].sort((a, b) => (b.title || '').length - (a.title || '').length);
            for (const n of sortedNotes) {
                if (message.includes(`@${n.title}`) && n.id !== activeNoteId) {
                    mentionMatches.push(n);
                }
            }

            if (mentionMatches.length > 0) {
                context += 'User explicitly mentioned these notes:\n\n';
                context += mentionMatches
                    .map((n) => `[Note: ${n.title} | Ref: ${n.title}#full]\n${n.body}`)
                    .join('\n\n---\n\n');
                citationBlock = mentionMatches.map((n) => `- ${n.title}#full`).join('\n');
            } else if (vectorStore && typeof vectorStore.retrieveRelevantChunks === 'function') {
                const rag = await vectorStore.retrieveRelevantChunks(message, { topK: 8, maxNotes: 6, chunksPerNote: 3 });
                if (rag.chunks.length > 0) {
                    context = rag.chunks
                        .map((c) => `[Note: ${c.noteTitle} | Ref: ${c.citation}]\n${c.chunk}`)
                        .join('\n\n---\n\n');
                    citationBlock = rag.citations.map((c) => `- ${c.ref}`).join('\n');
                }
            }

            if (activeNoteId) {
                const activeNote = notes.find((n) => n.id === activeNoteId);
                if (activeNote) {
                    const activeContext = `[Note: ${activeNote.title} | Ref: ${activeNote.title}#active]\n${activeNote.body}`;
                    context = context ? `${activeContext}\n\n---\n\n${context}` : activeContext;
                    citationBlock = citationBlock ? `- ${activeNote.title}#active\n${citationBlock}` : `- ${activeNote.title}#active`;
                }
            }

            let systemPrompt = `You are a helpful AI assistant integrated into a note-taking app called SmartNotes.\n\n${activeNoteId && context ? `The user is CURRENTLY VIEWING a note. Context:\n${context}` : context ? `Relevant notes:\n${context}` : 'No notes are currently open and no relevant notes were found.'}\n\nINSTRUCTIONS:\n- Answer based on the note content provided if applicable.\n- You can use Markdown.\n- If context is provided, include a short citation section at the end using these refs when relevant:\n${citationBlock || '- No citations available'}\n`;

            if (aiTools && typeof aiTools.getSystemPromptAddon === 'function') {
                systemPrompt += aiTools.getSystemPromptAddon();
            }

            return {
                context,
                citationBlock,
                systemPrompt
            };
        }

        async function runAgentLoop(options) {
            const systemPrompt = options.systemPrompt;
            const history = Array.isArray(options.history) ? options.history : [];
            const aiChat = options.aiChat;
            const executeTool = options.executeTool;
            const onToolExecution = typeof options.onToolExecution === 'function' ? options.onToolExecution : null;
            const maxTurns = typeof options.maxTurns === 'number' ? options.maxTurns : 5;

            if (typeof aiChat !== 'function') {
                throw new Error('aiChat callback is required');
            }

            let messages = [
                { role: 'system', content: systemPrompt },
                ...history.slice(-10)
            ];

            let turn = 0;
            let finalResponse = '';

            while (turn < maxTurns) {
                const responseText = await aiChat(messages);
                const toolCall = parseToolCall(responseText);

                if (toolCall && typeof executeTool === 'function') {
                    if (onToolExecution) {
                        onToolExecution(toolCall);
                    }

                    const toolResult = await executeTool(toolCall);
                    messages.push({ role: 'assistant', content: JSON.stringify(toolCall) });
                    messages.push({ role: 'user', content: `Tool Result: ${toolResult}` });
                    turn += 1;
                    continue;
                }

                finalResponse = responseText;
                break;
            }

            if (!finalResponse) {
                finalResponse = "I'm sorry, I got stuck in a loop trying to perform actions.";
            }

            return {
                finalResponse,
                turns: turn
            };
        }

        async function generateAssistantReply(options) {
            const promptBundle = await buildPrompt({
                message: options.message,
                notes: options.notes,
                activeNoteId: options.activeNoteId
            });

            return runAgentLoop({
                systemPrompt: promptBundle.systemPrompt,
                history: options.history,
                aiChat: options.aiChat,
                executeTool: options.executeTool,
                onToolExecution: options.onToolExecution,
                maxTurns: options.maxTurns
            });
        }

        return {
            buildPrompt,
            parseToolCall,
            runAgentLoop,
            generateAssistantReply
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createChatRagService };
    }

    const service = createChatRagService({
        VectorStore: global.VectorStore,
        AITools: global.AITools
    });

    global.ChatRagService = service;
})(typeof window !== 'undefined' ? window : globalThis);
