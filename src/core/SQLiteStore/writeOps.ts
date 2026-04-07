import { EMBEDDING_DIMENSION } from '../../constants';
import type { Chunk, IndexedDocument, IndexedFile, ParsedFile } from '../../types';
import type { EmbeddingCacheEntry } from './storeTypes';

type RunFn = (
  sql: string,
  params?: (string | number | bigint | ArrayBuffer | Uint8Array | null)[],
) => Promise<void>;
type QueryOneFn = <T extends Record<string, unknown>>(
  sql: string,
  params?: (string | number | bigint | ArrayBuffer | Uint8Array | null)[],
) => Promise<T | null>;

export class SQLiteWriteOps {
  constructor(
    private readonly documents: Map<string, IndexedDocument>,
    private readonly embeddingCache: EmbeddingCacheEntry[],
    private readonly removeFromEmbeddingCache: (fileId: number) => void,
    private readonly updateChunkLookup: (path: string) => void,
    private readonly removeChunkLookupForFile: (fileId: number) => void,
    private readonly run: RunFn,
    private readonly queryOne: QueryOneFn,
  ) {}

  upsertInMemory(
    parsedFile: ParsedFile,
    fileMeta: { mtime: number; size: number },
    embeddings: Float32Array[],
    nextFileId: number,
    nextChunkId: number,
  ): { fileId: number; nextFileId: number; nextChunkId: number } {
    const existingDoc = this.documents.get(parsedFile.path);
    const fileId = existingDoc?.file.id ?? nextFileId++;
    const indexedAt = Date.now();

    const file: IndexedFile = {
      id: fileId,
      path: parsedFile.path,
      mtime: fileMeta.mtime,
      size: fileMeta.size,
      title: parsedFile.title,
      indexedAt,
    };

    const chunks: Chunk[] = parsedFile.chunks.map((rawChunk, i) => ({
      id: nextChunkId++,
      fileId,
      chunkIdx: i,
      content: rawChunk.content,
      heading: rawChunk.heading,
      tokenCount: rawChunk.tokenCount,
      embedding: embeddings[i] ?? new Float32Array(EMBEDDING_DIMENSION),
    }));

    this.documents.set(parsedFile.path, { file, chunks, frontmatter: parsedFile.frontmatter });
    this.updateChunkLookup(parsedFile.path);
    this.removeFromEmbeddingCache(fileId);
    for (const chunk of chunks) {
      this.embeddingCache.push({
        chunkId: chunk.id,
        fileId,
        embedding: new Float32Array(chunk.embedding),
      });
    }

    return { fileId, nextFileId, nextChunkId };
  }

  async persistUpsert(
    parsedFile: ParsedFile,
    fileMeta: { mtime: number; size: number },
    embeddings: Float32Array[],
  ): Promise<void> {
    const indexedAt = Date.now();
    await this.run('BEGIN');
    try {
      await this.run('DELETE FROM files WHERE path = ?', [parsedFile.path]);
      await this.run(
        'INSERT INTO files(path, mtime, size, title, indexed_at) VALUES (?, ?, ?, ?, ?)',
        [parsedFile.path, fileMeta.mtime, fileMeta.size, parsedFile.title, indexedAt],
      );

      const fileIdRow = await this.queryOne<{ id: number }>('SELECT last_insert_rowid() AS id');
      if (!fileIdRow) {
        await this.run('ROLLBACK');
        return;
      }

      for (let i = 0; i < parsedFile.chunks.length; i++) {
        const chunk = parsedFile.chunks[i];
        if (!chunk) {
          continue;
        }
        const embedding = embeddings[i] ?? new Float32Array(EMBEDDING_DIMENSION);
        const rawBuf = embedding.buffer;
        const embeddingBuffer: ArrayBuffer =
          rawBuf instanceof ArrayBuffer
            ? rawBuf.slice(embedding.byteOffset, embedding.byteOffset + embedding.byteLength)
            : new Uint8Array(new Uint8Array(rawBuf, embedding.byteOffset, embedding.byteLength)).buffer;

        await this.run(
          'INSERT INTO chunks(file_id, chunk_idx, content, heading, token_count, embedding) VALUES (?, ?, ?, ?, ?, ?)',
          [fileIdRow.id, i, chunk.content, chunk.heading ?? null, chunk.tokenCount, embeddingBuffer],
        );
      }
      await this.run('COMMIT');
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  removeInMemory(path: string): void {
    const doc = this.documents.get(path);
    if (!doc) return;
    this.removeChunkLookupForFile(doc.file.id);
    this.removeFromEmbeddingCache(doc.file.id);
    this.documents.delete(path);
  }

  renameInMemory(oldPath: string, newPath: string): void {
    const doc = this.documents.get(oldPath);
    if (!doc) return;
    const updatedDoc: IndexedDocument = {
      ...doc,
      file: { ...doc.file, path: newPath },
    };
    this.documents.delete(oldPath);
    this.documents.set(newPath, updatedDoc);
    this.updateChunkLookup(newPath);
  }
}
