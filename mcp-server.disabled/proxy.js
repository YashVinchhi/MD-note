
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { SSEClientTransport } = require("@modelcontextprotocol/sdk/client/sse.js");
const { z } = require("zod");

// This proxy connects to the running Bridge (port 3000) and exposes it via Stdio
// This allows Claude Desktop to control the one single instance of the Bridge.

async function startProxy() {
    // 1. Connect to the Real Bridge
    const transport = new SSEClientTransport(new URL("http://localhost:3000/sse"));
    const client = new Client({ name: "ClaudeProxy", version: "1.0.0" }, { capabilities: {} });

    try {
        await client.connect(transport);
    } catch (e) {
        console.error("Failed to connect to Local Bridge on port 3000. Is server.py running?");
        process.exit(1);
    }

    // 2. Setup Stdio Server for Claude
    const server = new McpServer({ name: "SmartNotes Proxy", version: "1.0.0" });

    // 3. Define Forwarding Tools (Mirroring index.js)

    // Helper to forward calls
    const forward = async (name, args) => {
        try {
            const result = await client.callTool({ name, arguments: args });
            return { content: result.content };
        } catch (e) {
            return { content: [{ type: "text", text: `Error calling tool ${name}: ${e.message}` }] };
        }
    };

    server.tool("create_note",
        {
            title: z.string(),
            content: z.string(),
            tags: z.array(z.string()).optional()
        },
        (args) => forward("create_note", args)
    );

    server.tool("update_note",
        {
            id: z.string(),
            content: z.string(),
            mode: z.enum(["append", "overwrite"]).optional()
        },
        (args) => forward("update_note", args)
    );

    server.tool("search_notes",
        { query: z.string() },
        (args) => forward("search_notes", args)
    );

    server.tool("read_note",
        { id: z.string() },
        (args) => forward("read_note", args)
    );

    server.tool("list_folders",
        {},
        (args) => forward("list_folders", args)
    );

    server.tool("find_note_by_title",
        { title: z.string() },
        (args) => forward("find_note_by_title", args)
    );

    // 4. Start Stdio Server
    const serverTransport = new StdioServerTransport();
    await server.connect(serverTransport);
    console.error("SmartNotes Proxy Started (Stdio -> SSE)");
}

startProxy();
