
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { z } = require("zod");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

// --- Configuration ---
const MCP_PORT = 3000;
const CLIENT_ORIGIN = "*"; // Allow all for local dev, restrict in prod if needed

// --- Express & Socket.io Setup ---
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: CLIENT_ORIGIN,
        methods: ["GET", "POST"]
    }
});

let connectedSocket = null;

io.on("connection", (socket) => {
    console.log("Browser App Connected (Socket ID:", socket.id + ")");
    connectedSocket = socket;

    socket.on("disconnect", () => {
        console.log("Browser App Disconnected");
        if (connectedSocket === socket) connectedSocket = null;
    });

    socket.on("tool_result", (data) => {
        // This handler handles async responses from the browser tool execution
        // We handle the promise resolution in the tool execution block below
        // via the pendingRequests map.
    });
});

// --- Pending Requests Map ---
// Maps requestId -> { resolve, reject, timeout }
const pendingRequests = new Map();

function executeBrowserTool(toolName, args) {
    return new Promise((resolve, reject) => {
        if (!connectedSocket) {
            return resolve({
                content: [{ type: "text", text: "Error: SmartNotes App is not open. Please open the app in your browser to use this tool." }]
            });
        }

        const requestId = Date.now().toString() + Math.random().toString().slice(2);

        // Timeout after 15 seconds
        const timeout = setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                resolve({ content: [{ type: "text", text: "Error: Tool execution timed out. Browser did not respond." }] });
            }
        }, 15000);

        pendingRequests.set(requestId, { resolve, reject, timeout });

        // Emit to Browser
        connectedSocket.emit("mcp:execute_tool", {
            requestId,
            tool: toolName,
            arguments: args
        });
    });
}

// Handle responses from Browser
io.on("connection", (socket) => {
    socket.on("mcp:tool_result", (data) => {
        const { requestId, result, error } = data;
        const pending = pendingRequests.get(requestId);

        if (pending) {
            clearTimeout(pending.timeout);
            pendingRequests.delete(requestId);

            if (error) {
                pending.resolve({ content: [{ type: "text", text: `Error: ${error}` }] });
            } else {
                // Ensure result is a string
                const textResult = typeof result === 'string' ? result : JSON.stringify(result);
                pending.resolve({ content: [{ type: "text", text: textResult }] });
            }
        }
    });
});

// --- MCP Server Setup ---
const mcp = new McpServer({
    name: "SmartNotes Bridge",
    version: "1.0.0"
});

// --- Tool Definitions (Mirroring ai-tools.js) ---

mcp.tool("create_note",
    {
        title: z.string().describe("The title of the note"),
        content: z.string().describe("The markdown content of the note"),
        tags: z.array(z.string()).optional().describe("Optional list of tags")
    },
    async (args) => {
        console.log("MCP: create_note called");
        return await executeBrowserTool("create_note", args);
    }
);

mcp.tool("update_note",
    {
        id: z.string().describe("The ID of the note to update"),
        content: z.string().describe("The text to add or replace"),
        mode: z.enum(["append", "overwrite"]).optional().describe("Defaults to 'append'")
    },
    async (args) => {
        console.log("MCP: update_note called");
        return await executeBrowserTool("update_note", args);
    }
);

mcp.tool("search_notes",
    {
        query: z.string().describe("Search query string (title and content)")
    },
    async (args) => {
        console.log("MCP: search_notes called");
        return await executeBrowserTool("search_notes", args);
    }
);

mcp.tool("read_note",
    {
        id: z.string().describe("Calculated Note ID")
    },
    async (args) => {
        console.log("MCP: read_note called");
        return await executeBrowserTool("read_note", args);
    }
);

mcp.tool("list_folders",
    {},
    async (args) => {
        console.log("MCP: list_folders called");
        return await executeBrowserTool("list_folders", args || {});
    }
);

mcp.tool("find_note_by_title",
    {
        title: z.string().describe("The title of the note to find")
    },
    async (args) => {
        console.log("MCP: find_note_by_title called");
        return await executeBrowserTool("find_note_by_title", args);
    }
);
// --- Start Server ---

async function start() {
    const transport = new SSEServerTransport("/sse", app);
    await mcp.connect(transport);

    server.listen(MCP_PORT, () => {
        console.log(`MCP Bridge Server running on http://localhost:${MCP_PORT}/sse`);
        console.log(`Socket.io listening for Browser connection...`);
    });
}

start();
