#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

const { createNoteListService } = require('../note-list.js');
const { createChatRagService } = require('../chat-rag-service.js');

const rootDir = path.resolve(__dirname, '..');
const reportsDir = path.join(rootDir, 'reports', 'baseline');
const vectorStorePath = path.join(rootDir, 'vector-store.js');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function benchmark(name, iterations, fn) {
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    samples.push(t1 - t0);
  }

  return {
    name,
    iterations,
    p50Ms: Number(percentile(samples, 50).toFixed(3)),
    p95Ms: Number(percentile(samples, 95).toFixed(3)),
    avgMs: Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3))
  };
}

function makeNotes(count) {
  const notes = [];
  for (let i = 0; i < count; i += 1) {
    notes.push({
      id: `n-${i}`,
      title: `Project ${i}`,
      body: `This note covers roadmap milestone ${i} and search index behavior.`,
      tags: i % 2 === 0 ? ['work/roadmap', 'search'] : ['personal'],
      pinned: i % 7 === 0,
      folderId: i % 3 === 0 ? 'f-a' : 'f-b'
    });
  }
  return notes;
}

function loadVectorStore() {
  const code = fs.readFileSync(vectorStorePath, 'utf-8');
  const sandbox = {
    window: {},
    db: {},
    AIService: {},
    NoteDAO: {},
    updateSyncStatus: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'vector-store.js' });
  return sandbox.window.VectorStore;
}

async function chatLatencyBaseline() {
  const service = createChatRagService({
    VectorStore: null,
    AITools: null
  });

  const history = [{ role: 'user', content: 'Summarize notes' }];

  const firstTokenSamples = [];
  const fullResponseSamples = [];

  for (let i = 0; i < 25; i += 1) {
    let firstTokenAt = null;
    const started = performance.now();

    await service.runAgentLoop({
      systemPrompt: 'You are helpful.',
      history,
      aiChat: async (messages) => {
        await new Promise((resolve) => setTimeout(resolve, 8));
        if (firstTokenAt === null) {
          firstTokenAt = performance.now();
        }
        const hasToolResult = messages.some((m) => typeof m.content === 'string' && m.content.includes('Tool Result:'));
        if (!hasToolResult) {
          return '{"tool":"search_notes","arguments":{"query":"notes"}}';
        }
        return 'Completed response.';
      },
      executeTool: async () => {
        await new Promise((resolve) => setTimeout(resolve, 4));
        return '[]';
      },
      maxTurns: 3
    });

    const ended = performance.now();
    firstTokenSamples.push(firstTokenAt - started);
    fullResponseSamples.push(ended - started);
  }

  return {
    firstTokenLatency: {
      p50Ms: Number(percentile(firstTokenSamples, 50).toFixed(3)),
      p95Ms: Number(percentile(firstTokenSamples, 95).toFixed(3)),
      avgMs: Number((firstTokenSamples.reduce((a, b) => a + b, 0) / firstTokenSamples.length).toFixed(3))
    },
    fullResponseLatency: {
      p50Ms: Number(percentile(fullResponseSamples, 50).toFixed(3)),
      p95Ms: Number(percentile(fullResponseSamples, 95).toFixed(3)),
      avgMs: Number((fullResponseSamples.reduce((a, b) => a + b, 0) / fullResponseSamples.length).toFixed(3))
    }
  };
}

async function main() {
  const noteList = createNoteListService({
    escapeHtml: (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  });

  const notes1k = makeNotes(1000);
  const notes5k = makeNotes(5000);

  const search1k = benchmark('search-latency-1k', 40, () => {
    noteList.filterNotes(notes1k, {
      filter: 'all',
      searchQuery: 'roadmap',
      includeTagsInSearch: true,
      activeFolderId: null
    });
  });

  const search5k = benchmark('search-latency-5k', 40, () => {
    noteList.filterNotes(notes5k, {
      filter: 'all',
      searchQuery: 'roadmap',
      includeTagsInSearch: true,
      activeFolderId: null
    });
  });

  const render1k = benchmark('note-list-render-1k', 25, () => {
    noteList.renderNoteListHtml(notes1k.slice(0, 400), {
      activeNoteId: 'n-5',
      nestedTagRendering: true
    });
  });

  const render5k = benchmark('note-list-render-5k', 25, () => {
    noteList.renderNoteListHtml(notes5k.slice(0, 1200), {
      activeNoteId: 'n-5',
      nestedTagRendering: true
    });
  });

  const vectorStore = loadVectorStore();
  const indexSampleNotes = makeNotes(2000);
  const indexStart = performance.now();
  for (const note of indexSampleNotes) {
    vectorStore._chunkText(note.body, 420, 80);
  }
  const indexEnd = performance.now();
  const indexDurationMs = indexEnd - indexStart;
  const notesPerMinute = indexSampleNotes.length / (indexDurationMs / 60000);

  const chat = await chatLatencyBaseline();

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform
    },
    metrics: {
      searchLatency: {
        notes1k: search1k,
        notes5k: search5k
      },
      chatLatency: chat,
      noteListRenderTime: {
        notes1k: render1k,
        notes5k: render5k
      },
      indexingThroughput: {
        sampleSize: indexSampleNotes.length,
        durationMs: Number(indexDurationMs.toFixed(3)),
        notesPerMinute: Number(notesPerMinute.toFixed(2)),
        method: 'VectorStore._chunkText preprocessing throughput'
      }
    }
  };

  ensureDir(reportsDir);
  const outPath = path.join(reportsDir, 'perf-baseline.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`Wrote performance baseline report: ${outPath}`);
  console.log(`Search p95 (1k): ${search1k.p95Ms} ms`);
  console.log(`Search p95 (5k): ${search5k.p95Ms} ms`);
  console.log(`Indexing throughput: ${report.metrics.indexingThroughput.notesPerMinute} notes/min`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
