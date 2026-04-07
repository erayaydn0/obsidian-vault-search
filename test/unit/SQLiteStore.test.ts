import { describe, expect, it, beforeEach } from 'bun:test';

import { SQLiteStore } from '../../src/core/SQLiteStore/index';
import { DEFAULT_SETTINGS } from '../../src/types';
import {
  createTestSettings,
  makeInMemoryStore,
  makeOneHotEmbedding,
  makeParsedFile,
} from '../helpers/testHarness';

describe('SQLiteStore', () => {
  let store: SQLiteStore;

  beforeEach(() => {
    store = makeInMemoryStore();
  });

  it('upsertFile adds a document', async () => {
    const parsed = makeParsedFile('notes/a.md', 'Note A', 'Hello world content here');
    await store.upsertFile(parsed, { mtime: 1000, size: 100 }, [makeOneHotEmbedding(0)]);

    const docs = await store.listDocuments();
    expect(docs.length).toBe(1);
    expect(docs[0]!.file.path).toBe('notes/a.md');
    expect(docs[0]!.file.title).toBe('Note A');
  });

  it('hasFileChanged returns true for new file', () => {
    expect(store.hasFileChanged('notes/new.md', 1234)).toBe(true);
  });

  it('hasFileChanged returns false when mtime matches', async () => {
    const parsed = makeParsedFile('notes/b.md', 'Note B', 'Content');
    await store.upsertFile(parsed, { mtime: 5000, size: 50 }, [makeOneHotEmbedding(1)]);
    expect(store.hasFileChanged('notes/b.md', 5000)).toBe(false);
  });

  it('hasFileChanged returns true when mtime differs', async () => {
    const parsed = makeParsedFile('notes/b.md', 'Note B', 'Content');
    await store.upsertFile(parsed, { mtime: 5000, size: 50 }, [makeOneHotEmbedding(1)]);
    expect(store.hasFileChanged('notes/b.md', 9999)).toBe(true);
  });

  it('removeFile deletes the document', async () => {
    const parsed = makeParsedFile('notes/c.md', 'Note C', 'To be deleted');
    await store.upsertFile(parsed, { mtime: 1, size: 10 }, [makeOneHotEmbedding(2)]);
    await store.removeFile('notes/c.md');
    const docs = await store.listDocuments();
    expect(docs.length).toBe(0);
  });

  it('renameFile updates the path', async () => {
    const parsed = makeParsedFile('old/path.md', 'Renamed Note', 'content');
    await store.upsertFile(parsed, { mtime: 1, size: 8 }, [makeOneHotEmbedding(3)]);
    await store.renameFile('old/path.md', 'new/path.md');

    const docs = await store.listDocuments();
    expect(docs.length).toBe(1);
    expect(docs[0]!.file.path).toBe('new/path.md');
  });

  it('upsertFile replaces existing document (no duplicates)', async () => {
    const parsed = makeParsedFile('notes/dup.md', 'Dup', 'original content');
    await store.upsertFile(parsed, { mtime: 1, size: 10 }, [makeOneHotEmbedding(4)]);

    const updated = makeParsedFile('notes/dup.md', 'Dup Updated', 'updated content');
    await store.upsertFile(updated, { mtime: 2, size: 15 }, [makeOneHotEmbedding(4)]);

    const docs = await store.listDocuments();
    expect(docs.length).toBe(1);
    expect(docs[0]!.file.title).toBe('Dup Updated');
  });

  it('getIndexedPaths returns all indexed paths', async () => {
    await store.upsertFile(makeParsedFile('a.md', 'A', 'a'), { mtime: 1, size: 1 }, [makeOneHotEmbedding(0)]);
    await store.upsertFile(makeParsedFile('b.md', 'B', 'b'), { mtime: 1, size: 1 }, [makeOneHotEmbedding(1)]);
    const paths = store.getIndexedPaths();
    expect(paths.has('a.md')).toBe(true);
    expect(paths.has('b.md')).toBe(true);
  });

  it('search with keyword returns results ordered by relevance', async () => {
    await store.upsertFile(
      makeParsedFile('q.md', 'Quantum Note', 'quantum computing qubits superposition'),
      { mtime: 1, size: 30 },
      [makeOneHotEmbedding(10)],
    );
    await store.upsertFile(
      makeParsedFile('c.md', 'Classical Note', 'classical binary deterministic'),
      { mtime: 1, size: 25 },
      [makeOneHotEmbedding(20)],
    );

    const queryVec = makeOneHotEmbedding(10); // matches quantum note embedding
    const results = store.searchOps.search('quantum qubits', queryVec, {
      limit: 10,
      minScore: 0,
      weights: { bm25: 0.5, vector: 0.4, title: 0.1 },
    });

    expect(results.length).toBeGreaterThan(0);
    // Quantum note should score higher for this query
    expect(results[0]!.file.path).toBe('q.md');
  });

  it('searchBySignal returns three signal lists', async () => {
    await store.upsertFile(
      makeParsedFile('q.md', 'Quantum Note', 'quantum computing'),
      { mtime: 1, size: 15 },
      [makeOneHotEmbedding(5)],
    );

    const queryVec = makeOneHotEmbedding(5);
    const { bm25Results, vectorResults, titleResults } =
      store.searchOps.searchBySignal('quantum', queryVec);

    expect(bm25Results.length).toBeGreaterThan(0);
    expect(vectorResults.length).toBeGreaterThan(0);
    expect(titleResults.length).toBeGreaterThan(0);
  });

  it('getStats returns correct file count', async () => {
    await store.upsertFile(makeParsedFile('x.md', 'X', 'x'), { mtime: 1, size: 1 }, [makeOneHotEmbedding(0)]);
    const stats = await store.getStats();
    expect(stats.totalFiles).toBe(1);
    expect(stats.totalChunks).toBe(1);
  });

  it('hasFileChangedAsync mirrors in-memory mtime checks', async () => {
    await store.upsertFile(
      makeParsedFile('mtime.md', 'mtime', 'content'),
      { mtime: 2222, size: 10 },
      [makeOneHotEmbedding(7)],
    );
    await expect(store.hasFileChangedAsync('mtime.md', 2222)).resolves.toBe(false);
    await expect(store.hasFileChangedAsync('mtime.md', 3333)).resolves.toBe(true);
  });

  it('getIndexedPathsAsync returns indexed files without sqlite connection', async () => {
    await store.upsertFile(
      makeParsedFile('async-path.md', 'Async Path', 'content'),
      { mtime: 1, size: 1 },
      [makeOneHotEmbedding(2)],
    );
    const paths = await store.getIndexedPathsAsync();
    expect(paths.has('async-path.md')).toBe(true);
  });

  it('clearAllData resets in-memory docs and stats', async () => {
    await store.upsertFile(
      makeParsedFile('reset.md', 'Reset', 'content'),
      { mtime: 10, size: 10 },
      [makeOneHotEmbedding(9)],
    );
    await store.clearAllData();

    const docs = await store.listDocuments();
    const stats = await store.getStats();
    expect(docs).toEqual([]);
    expect(store.getIndexedPaths().size).toBe(0);
    expect(stats.totalFiles).toBe(0);
  });

  it('applySettings clears data when model changes', async () => {
    await store.upsertFile(
      makeParsedFile('model.md', 'Model', 'content'),
      { mtime: 1, size: 10 },
      [makeOneHotEmbedding(11)],
    );

    await store.applySettings(
      createTestSettings({
        modelName: `${DEFAULT_SETTINGS.modelName}-changed`,
      }),
    );

    const docs = await store.listDocuments();
    expect(docs).toEqual([]);
  });
});
