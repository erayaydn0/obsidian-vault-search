import { beforeEach, describe, expect, it } from 'bun:test';

import { SearchEngine } from '../../src/core/SearchEngine';
import { type SQLiteStore } from '../../src/core/SQLiteStore/index';
import { DEFAULT_SETTINGS } from '../../src/types';
import {
  createStubEmbedder,
  createTestSettings,
  makeInMemoryStore,
  type StubEmbeddingEngine,
} from '../helpers/testHarness';

async function populateStore(store: SQLiteStore, embedder: StubEmbeddingEngine): Promise<void> {
  const docs = [
    {
      path: 'quantum/intro.md',
      title: 'Quantum Computing Introduction',
      body: 'Quantum bits or qubits can be in superposition states. This enables massive parallelism.',
    },
    {
      path: 'classical/intro.md',
      title: 'Classical Computing Basics',
      body: 'Classical computers use binary bits: 0 and 1. They follow deterministic operations.',
    },
    {
      path: 'notes/entanglement.md',
      title: 'Entanglement',
      body: 'Quantum entanglement allows qubits to be correlated across distance.',
    },
  ];

  for (const doc of docs) {
    const embeddings = await embedder.embedBatch([doc.body]);
    await store.upsertFile(
      {
        path: doc.path,
        title: doc.title,
        frontmatter: {},
        chunks: [{ content: doc.body, heading: null, tokenCount: doc.body.split(' ').length }],
      },
      { mtime: Date.now(), size: doc.body.length },
      embeddings,
    );
  }
}

describe('SearchEngine', () => {
  let store: SQLiteStore;
  let embedder: StubEmbeddingEngine;
  let engine: SearchEngine;

  beforeEach(async () => {
    store = makeInMemoryStore();
    embedder = createStubEmbedder();
    engine = new SearchEngine(store, embedder, DEFAULT_SETTINGS);
    await populateStore(store, embedder);
  });

  it('returns empty array for short query', async () => {
    const results = await engine.search('a');
    expect(results).toEqual([]);
  });

  it('returns results for a valid query', async () => {
    const results = await engine.search('quantum');
    expect(results.length).toBeGreaterThan(0);
  });

  it('quantum query ranks classical note below quantum notes', async () => {
    const results = await engine.search('quantum qubits');
    expect(results.length).toBeGreaterThan(0);
    // Classical note should NOT be the top result for a quantum query
    const classicalIdx = results.findIndex((r) => r.path.includes('classical'));
    if (classicalIdx !== -1) {
      // At least one quantum-related note should rank above classical
      const topResult = results[0];
      expect(topResult.path).not.toBe('classical/intro.md');
    }
  });

  it('results have required fields', async () => {
    const results = await engine.search('quantum');
    const first = results[0];
    expect(first).toBeDefined();
    expect(typeof first.path).toBe('string');
    expect(typeof first.title).toBe('string');
    expect(typeof first.snippet).toBe('string');
    expect(typeof first.score).toBe('number');
    expect(['semantic', 'keyword', 'title', 'hybrid']).toContain(first.matchType);
    expect(typeof first.scores.rrf).toBe('number');
  });

  it('getRelated excludes the source note', async () => {
    const related = await engine.getRelated('quantum/intro.md');
    const paths = related.map((r) => r.path);
    expect(paths).not.toContain('quantum/intro.md');
  });

  it('limit option is respected', async () => {
    const results = await engine.search('quantum', { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('returns empty list when limit is zero', async () => {
    const results = await engine.search('quantum', { limit: 0 });
    expect(results).toEqual([]);
  });

  it('excludePaths filters out matching files', async () => {
    const results = await engine.search('quantum', {
      excludePaths: ['quantum/intro.md'],
    });
    expect(results.some((result) => result.path === 'quantum/intro.md')).toBe(false);
  });

  it('minScore filters out low-scoring items', async () => {
    const results = await engine.search('quantum', { minScore: 1000 });
    expect(results).toEqual([]);
  });

  it('semantic-only mode emits semantic scores only', async () => {
    const semanticSettings = createTestSettings({
      searchMode: 'semantic-only',
      weights: { bm25: 0.25, vector: 0.5, title: 0.25 },
    });
    const semanticEngine = new SearchEngine(store, embedder, semanticSettings);
    const results = await semanticEngine.search('quantum');

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.scores.bm25).toBe(0);
      expect(result.scores.title).toBe(0);
      expect(result.matchType).toBe('semantic');
    }
  });

  it('getRelated returns empty list for unknown path', async () => {
    const related = await engine.getRelated('unknown/path.md');
    expect(related).toEqual([]);
  });

  it('returns empty list when index has no files', async () => {
    const emptyStore = makeInMemoryStore();
    const emptyEngine = new SearchEngine(emptyStore, embedder, DEFAULT_SETTINGS);
    const results = await emptyEngine.search('quantum');
    expect(results).toEqual([]);
  });

  it('tracks search history', async () => {
    await engine.search('quantum computing');
    await engine.search('entanglement');
    const history = engine.getHistory();
    expect(history).toContain('quantum computing');
    expect(history).toContain('entanglement');
  });
});
