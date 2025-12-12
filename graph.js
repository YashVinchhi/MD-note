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


    // --- Deduplication logic ---
    // We'll use a Map to store unique edges by sorted node pair (A,B)
    // and keep the most "distinctive" style (WikiLink > AI > Tag)
    const edgeMap = new Map();

    // Helper to get a unique key for an edge (undirected)
    function edgeKey(a, b) {
        return [a, b].sort().join('::');
    }

    // 1. WikiLinks
    notes.forEach(note => {
        if (note.wikiLinks && note.wikiLinks.length > 0) {
            note.wikiLinks.forEach(linkTitle => {
                const targetId = findNoteIdByTitle(linkTitle);
                if (targetId) {
                    const key = edgeKey(note.id, targetId);
                    edgeMap.set(key, { from: note.id, to: targetId });
                }
            });
        }
    });

    // 2. AI Links (only add if not already present as WikiLink)
    notes.forEach(note => {
        if (note.aiLinks && note.aiLinks.length > 0) {
            note.aiLinks.forEach(targetId => {
                if (notes.find(n => n.id === targetId)) {
                    const key = edgeKey(note.id, targetId);
                    if (!edgeMap.has(key)) {
                        edgeMap.set(key, {
                            from: note.id,
                            to: targetId,
                            dashes: true,
                            color: { inherit: false, color: '#a855f7', opacity: 0.6 }
                        });
                    }
                }
            });
        }
    });

    // 3. Tag Connections (only add if not already present as WikiLink or AI Link)
    for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) {
            const A = notes[i];
            const B = notes[j];
            const commonTags = A.tags.filter(tag => B.tags.includes(tag));
            if (commonTags.length > 0) {
                const key = edgeKey(A.id, B.id);
                if (!edgeMap.has(key)) {
                    edgeMap.set(key, {
                        from: A.id,
                        to: B.id,
                        color: { opacity: 0.2 },
                        dashes: true
                    });
                }
            }
        }
    }

    // Add all unique edges
    edgesData.push(...edgeMap.values());

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
