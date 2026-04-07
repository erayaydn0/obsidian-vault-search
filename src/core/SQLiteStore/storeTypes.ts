import type { Chunk, IndexedDocument } from '../../types';

export interface EmbeddingCacheEntry {
  chunkId: number;
  fileId: number;
  embedding: Float32Array;
}

export interface ChunkLookupEntry {
  doc: IndexedDocument;
  chunk: Chunk;
}

export interface BM25Result {
  chunkId: number;
  fileId: number;
  path: string;
  title: string;
  content: string;
  heading: string | null;
  bm25Score: number;
}

export interface VectorResult {
  chunkId: number;
  fileId: number;
  path: string;
  title: string;
  content: string;
  heading: string | null;
  vectorScore: number;
}

export interface TitleResult {
  fileId: number;
  path: string;
  title: string;
  titleScore: number;
}

export interface RankedEntry {
  chunkId: number;
  fileId: number;
  path: string;
  title: string;
  content: string;
  heading: string | null;
  score: number;
  scores: { bm25: number; vector: number; title: number };
}
