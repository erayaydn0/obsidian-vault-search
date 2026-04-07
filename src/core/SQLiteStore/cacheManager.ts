import { EMBEDDING_DIMENSION } from '../../constants';
import type { Chunk, IndexedDocument, IndexedFile } from '../../types';

import type { ChunkLookupEntry, EmbeddingCacheEntry } from './storeTypes';

type QueryAllFn = <T extends Record<string, unknown>>(
  sql: string,
  params?: (string | number | bigint | ArrayBuffer | Uint8Array | null)[],
) => Promise<T[]>;

export class SQLiteCacheManager {
  constructor(
    private readonly documents: Map<string, IndexedDocument>,
    private readonly embeddingCache: EmbeddingCacheEntry[],
    private readonly chunkLookup: Map<number, ChunkLookupEntry>,
    private readonly fileChunkIds: Map<number, Set<number>>,
    private readonly setNextFileId: (value: number) => void,
    private readonly setNextChunkId: (value: number) => void,
  ) {}

  removeFromEmbeddingCache(fileId: number): void {
    for (let i = this.embeddingCache.length - 1; i >= 0; i--) {
      if (this.embeddingCache[i]?.fileId === fileId) {
        this.embeddingCache.splice(i, 1);
      }
    }
  }

  async buildFilePathMap(queryAll: QueryAllFn, hasSqlite: boolean): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    for (const doc of this.documents.values()) {
      map.set(doc.file.id, doc.file.path);
    }
    if (hasSqlite) {
      const rows = await queryAll<{ id: number; path: string }>('SELECT id, path FROM files');
      for (const row of rows) {
        map.set(row.id, row.path);
      }
    }
    return map;
  }

  updateChunkLookup(path: string): void {
    const doc = this.documents.get(path);
    if (!doc) return;
    this.removeChunkLookupForFile(doc.file.id);
    const chunkIds = new Set<number>();
    for (const chunk of doc.chunks) {
      chunkIds.add(chunk.id);
      this.chunkLookup.set(chunk.id, { doc, chunk });
    }
    this.fileChunkIds.set(doc.file.id, chunkIds);
  }

  removeChunkLookupForFile(fileId: number): void {
    const chunkIds = this.fileChunkIds.get(fileId);
    if (!chunkIds) return;
    for (const chunkId of chunkIds) {
      this.chunkLookup.delete(chunkId);
    }
    this.fileChunkIds.delete(fileId);
  }

  async loadDocumentsFromDb(queryAll: QueryAllFn, hasSqlite: boolean): Promise<void> {
    if (!hasSqlite) return;
    this.documents.clear();
    this.embeddingCache.length = 0;

    const fileRows = await queryAll<{
      id: number;
      path: string;
      mtime: number;
      size: number;
      title: string;
      indexed_at: number;
    }>('SELECT id, path, mtime, size, title, indexed_at FROM files');

    let nextFileId = 1;
    let nextChunkId = 1;

    for (const fileRow of fileRows) {
      const chunkRows = await queryAll<{
        id: number;
        chunk_idx: number;
        content: string;
        heading: string | null;
        token_count: number;
        embedding: Uint8Array | ArrayBuffer;
      }>(
        'SELECT id, chunk_idx, content, heading, token_count, embedding FROM chunks WHERE file_id = ? ORDER BY chunk_idx',
        [fileRow.id],
      );

      const file: IndexedFile = {
        id: fileRow.id,
        path: fileRow.path,
        mtime: fileRow.mtime,
        size: fileRow.size,
        title: fileRow.title,
        indexedAt: fileRow.indexed_at,
      };

      const chunks: Chunk[] = chunkRows.map((c) => {
        const raw = c.embedding;
        let emb = new Float32Array(EMBEDDING_DIMENSION);
        if (raw instanceof Uint8Array && raw.byteLength === EMBEDDING_DIMENSION * 4) {
          emb = new Float32Array(raw.slice().buffer as ArrayBuffer);
        } else if (raw instanceof ArrayBuffer && raw.byteLength === EMBEDDING_DIMENSION * 4) {
          emb = new Float32Array(raw);
        }
        return {
          id: c.id,
          fileId: fileRow.id,
          chunkIdx: c.chunk_idx,
          content: c.content,
          heading: c.heading,
          tokenCount: c.token_count,
          embedding: emb,
        };
      });

      this.documents.set(fileRow.path, { file, chunks, frontmatter: {} });
      this.updateChunkLookup(fileRow.path);

      for (const chunk of chunks) {
        this.embeddingCache.push({
          chunkId: chunk.id,
          fileId: fileRow.id,
          embedding: new Float32Array(chunk.embedding),
        });
      }

      if (fileRow.id >= nextFileId) nextFileId = fileRow.id + 1;
      for (const c of chunkRows) {
        if (c.id >= nextChunkId) nextChunkId = c.id + 1;
      }
    }

    this.setNextFileId(nextFileId);
    this.setNextChunkId(nextChunkId);
  }
}
