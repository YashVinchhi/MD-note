/**
 * Knowledge Graph Module
 * Uses vis-network to visualize notes and connections
 */

let network = null;
let graphNodes = new vis.DataSet([]);
let graphEdges = new vis.DataSet([]);

// Configuration for the Network Visualization
const options = {
    nodes: {
        shape: 'dot',
        size: 20,
        font: {
            size: 14,
            face: 'Inter',
            color: '#374151' // Gray-700
        },
        borderWidth: 2,
        color: {
            background: '#cbd5e1', // Slate-300
            border: '#94a3b8',     // Slate-400
            highlight: {
                background: '#60a5fa', // Blue-400
                border: '#2563eb'      // Blue-600
            }
        }
    },
    edges: {
        width: 1,
        color: { inherit: 'from', opacity: 0.5 },
        smooth: {
            type: 'continuous'
        }
    },
    physics: {
        enabled: true,
        stabilization: {
            iterations: 200 // Stabilize before showing
        },
        barnesHut: {
            gravitationalConstant: -2000,
            centralGravity: 0.3,
            springLength: 150,
            springConstant: 0.04,
            damping: 0.09
        }
    },
    interaction: {
        hover: true,
        tooltipDelay: 200,
        zoomView: true
    }
};

/**
 * Initialize and render the graph
 * @param {string} containerId - DOM ID of the container
 */
async function renderGraph(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Fetch all notes
    const notes = await NoteDAO.getAll();

    // Clear existing data
    graphNodes.clear();
    graphEdges.clear();

    const nodesData = [];
    const edgesData = [];

    // Helper to find note ID by title (for WikiLinks)
    const findNoteIdByTitle = (title) => {
        const n = notes.find(note => note.title.toLowerCase() === title.toLowerCase());
        return n ? n.id : null;
    };

    // 1. Generate Nodes
    notes.forEach(note => {
        nodesData.push({
            id: note.id,
            label: note.title || 'Untitled',
            title: note.summary || 'No summary available' // Tooltip
        });
    });

    // 2. Generate Edges
    notes.forEach(note => {
        // A. WikiLinks Edges
        if (note.wikiLinks && note.wikiLinks.length > 0) {
            note.wikiLinks.forEach(linkTitle => {
                const targetId = findNoteIdByTitle(linkTitle);
                if (targetId) {
                    // Avoid duplicate edges (A->B and B->A) if not directional? 
                    // Vis-network handles multiedges ok, but let's just push unique directional for now
                    edgesData.push({ from: note.id, to: targetId });
                }
            });
        }

        // B. Shared Tags Edges (Optional: Can create "Cluster" or dense edges)
        // Heuristic: If 2 notes share a tag, connect them? 
        // This might create a hairball. Let's start with WikiLinks ONLY for cleaner graph.
        // User Requirement: "OR Note A and Note B share a unique tag"
        // Let's implement: For every pair of notes, if they intersect tags, add edge.
        // Optimization: Only do this for "unique" tags? "unique tag" might mean specific non-generic ones?
        // Let's just do: match tags strictly.

        // This is O(N^2), careful with large DB. 
        // For < 100 notes it's fine.
    });

    // Tag Edges (Separate Loop for clarity)
    // We iterate all unique pairs
    for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) {
            const A = notes[i];
            const B = notes[j];

            // Intersection of tags
            const commonTags = A.tags.filter(tag => B.tags.includes(tag));

            if (commonTags.length > 0) {
                edgesData.push({
                    from: A.id,
                    to: B.id,
                    color: { opacity: 0.2 }, // Fainter lines for tags
                    dashes: true
                });
            }
        }
    }

    graphNodes.add(nodesData);
    graphEdges.add(edgesData);

    // Create Network
    const data = { nodes: graphNodes, edges: graphEdges };

    if (network !== null) {
        network.destroy();
        network = null;
    }

    network = new vis.Network(container, data, options);

    // Events
    network.on("click", function (params) {
        if (params.nodes.length > 0) {
            const noteId = params.nodes[0];
            // Open note in editor
            setActiveNote(noteId);
            // Optionally: Switch back to list view? Or keep graph open?
            // "Clicking a node opens that note in the editor." 
            // If we are in "Graph View" which hides "List View", the Editor is still visible.
            // So we just load it. UI remains in Graph Mode.
        }
    });
}
