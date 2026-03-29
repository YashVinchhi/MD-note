
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { SSEClientTransport } = require("@modelcontextprotocol/sdk/client/sse.js");

async function runTest() {
    console.log("Connecting to MCP Bridge...");

    // Connect to the MCP Server (running on localhost:3000)
    const transport = new SSEClientTransport(new URL("http://localhost:3000/sse"));
    const client = new Client({
        name: "Test Client",
        version: "1.0.0"
    }, {
        capabilities: {}
    });

    try {
        await client.connect(transport);
        console.log("✓ Connected to MCP Server!");

        // List Tools
        const tools = await client.listTools();
        console.log("\nAvailable Tools:", tools.tools.map(t => t.name).join(", "));

        // Instructions
        console.log("\n---------------------------------------------------");
        console.log("NOW: Open the SmartNotes App in your browser.");
        console.log("Once open, we will try to search for notes.");
        console.log("---------------------------------------------------");

        // Simple wait loop to allow user to open browser
        setTimeout(async () => {
            console.log("\nAttempting to search notes (Bridge Test)...");
            try {
                const result = await client.callTool({
                    name: "search_notes",
                    arguments: { query: "" } // search all
                });
                console.log("\n✓ Tool Call Result:");
                console.log(result.content[0].text.substring(0, 200) + "...");
            } catch (e) {
                console.error("\n❌ Tool Call Failed:", e.message);
                console.log("Did you open the app in the browser?");
            }

            process.exit(0);
        }, 10000); // Wait 10 seconds

    } catch (e) {
        console.error("Connection Failed:", e);
        console.log("Ensure server.py is running and the MCP bridge started successfully.");
    }
}

runTest();
