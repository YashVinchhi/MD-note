
/**
 * AI Bridge - Browser Side
 * Connects to the local Node.js MCP server via Socket.io
 */
const AIBridge = {
    socket: null,
    status: 'disconnected',

    init() {
        if (typeof io === 'undefined') {
            console.error('Socket.io client library not loaded. AI Bridge cannot start.');
            return;
        }

        // Prefer an explicit override, then derive from current host.
        const bridgeUrl = window.SMARTNOTES_MCP_URL || `${window.location.protocol}//${window.location.hostname}:3000`;
        this.socket = io(bridgeUrl);

        this.socket.on('connect', () => {
            console.log('AI Bridge: Connected to MCP Server');
            this.status = 'connected';
            this.showToast('AI Bridge Connected', 'success');
        });

        this.socket.on('disconnect', () => {
            console.log('AI Bridge: Disconnected');
            this.status = 'disconnected';
        });

        this.socket.on('mcp:execute_tool', async (data) => {
            const { requestId, tool, arguments: args } = data;
            console.log(`AI Bridge: Received tool execution request: ${tool}`, args);

            try {
                // Execute using the existing AITools system
                let result = await AITools.execute(tool, args);

                // Send result back
                this.socket.emit('mcp:tool_result', {
                    requestId,
                    result: result
                });
            } catch (error) {
                console.error(`AI Bridge: Error executing tool ${tool}:`, error);
                this.socket.emit('mcp:tool_result', {
                    requestId,
                    error: error.message
                });
            }
        });
    },

    showToast(message, type = 'info') {
        // Use existing toast if available
        if (typeof showToast === 'function') {
            showToast(message, type === 'error');
        } else {
            console.log(`[AI Bridge Toast] ${message}`);
        }
    }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AIBridge.init());
} else {
    AIBridge.init(); // DOM already ready
}

window.AIBridge = AIBridge;
