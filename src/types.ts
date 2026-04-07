import { INDEX_DEFAULTS, MODEL_CACHE_SUBDIR, SEARCH_DEFAULTS } from './constants';

export interface IndexedFile {
  id: number;
  path: string;
  mtime: number;
  size: number;
  title: string;
  indexedAt: number;
}

export interface Chunk {
  id: number;
  fileId: number;
  chunkIdx: number;
  content: string;
  heading: string | null;
  tokenCount: number;
  embedding: Float32Array;
}

export interface IndexedDocument {
  file: IndexedFile;
  chunks: Chunk[];
  frontmatter: Record<string, unknown>;
}

export interface StoredChunk extends RawChunk {
  id: number;
  fileId: number;
  chunkIdx: number;
  path: string;
  title: string;
  embedding: Float32Array;
}

export interface RawChunk {
  content: string;
  heading: string | null;
  tokenCount: number;
}

export interface ParsedFile {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  chunks: RawChunk[];
}

export interface SearchWeights {
  /** Keyword relevance score contribution (BM25). */
  bm25: number;
  /** Semantic similarity contribution (cosine score). */
  vector: number;
  /** File-title fuzzy match contribution. */
  title: number;
}

/** Search execution mode used by SearchEngine. */
export type SearchMode = 'hybrid' | 'semantic-only';

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  weights?: SearchWeights;
  excludePaths?: string[];
}

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  snippet: string;
  heading: string | null;
  matchType: 'semantic' | 'keyword' | 'title' | 'hybrid';
  scores: {
    /** Weighted keyword score. */
    bm25: number;
    /** Weighted semantic score. */
    vector: number;
    /** Weighted title score. */
    title: number;
    /** Final fused ranking score (RRF/hybrid). */
    rrf: number;
  };
}

export interface SearchResultCandidate {
  path: string;
  title: string;
  chunkId: number;
  heading: string | null;
  content: string;
  embedding: Float32Array;
}

export interface RankedSearchEntry {
  file: IndexedFile;
  chunk: StoredChunk;
  score: number;
  scores: {
    /** Raw BM25 score before weight multiplication. */
    bm25: number;
    /** Raw vector similarity score before weight multiplication. */
    vector: number;
    /** Raw title fuzzy score before weight multiplication. */
    title: number;
  };
}

export interface SearchQuery {
  raw: string;
  embedding: Float32Array;
  tokens: string[];
}

export interface VaultSearchSettings {
  excludedPaths: string[];
  maxFileSizeMB: number;
  chunkMaxTokens: number;
  chunkOverlapTokens: number;
  modelName: string;
  modelCacheDir: string;
  defaultLimit: number;
  searchMode: SearchMode;
  weights: SearchWeights;
  sidebarEnabled: boolean;
  sidebarLimit: number;
  showScores: boolean;
}

export const DEFAULT_SETTINGS: VaultSearchSettings = {
  excludedPaths: [...INDEX_DEFAULTS.EXCLUDED_PATHS],
  maxFileSizeMB: INDEX_DEFAULTS.MAX_FILE_SIZE_MB,
  chunkMaxTokens: INDEX_DEFAULTS.CHUNK_MAX_TOKENS,
  chunkOverlapTokens: INDEX_DEFAULTS.CHUNK_OVERLAP_TOKENS,
  modelName: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
  modelCacheDir: MODEL_CACHE_SUBDIR,
  defaultLimit: SEARCH_DEFAULTS.LIMIT,
  searchMode: 'hybrid',
  weights: { bm25: 0.3, vector: 0.6, title: 0.1 },
  sidebarEnabled: true,
  sidebarLimit: 8,
  showScores: false,
};

export type IndexStatus = 'idle' | 'initializing' | 'indexing' | 'error';

export interface IndexStats {
  totalFiles: number;
  totalChunks: number;
  /** Unix epoch milliseconds for last full index run. */
  lastFullIndex: number | null;
  modelName: string;
  modelDimension: number;
  dbSizeBytes: number;
  /** Current lifecycle status of indexing/store. */
  status: IndexStatus;
}

export interface IndexProgress {
  total: number;
  processed: number;
  current: string;
  errors: string[];
}
