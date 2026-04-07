export const PLUGIN_ID = 'vault-search';
export const PLUGIN_NAME = 'VaultSearch';
export const VIEW_TYPE_SIDEBAR = 'vault-search-sidebar';

export const DB_FILENAME = 'index.db';
export const DB_DIR = '.obsidian/vault-search';
export const MODEL_CACHE_DIR = '.obsidian/vault-search/models';
export const SCHEMA_VERSION = 1;
export const EMBEDDING_DIMENSION = 384;

export const SEARCH_DEFAULTS = {
  LIMIT: 10,
  MIN_QUERY_LENGTH: 2,
  DEBOUNCE_MS: 200,
  RRF_K: 60,
} as const;

export const INDEX_DEFAULTS = {
  MAX_FILE_SIZE_MB: 1,
  CHUNK_MAX_TOKENS: 512,
  CHUNK_OVERLAP_TOKENS: 50,
  EXCLUDED_PATHS: ['.obsidian/**', 'node_modules/**', '*.excalidraw.md'],
} as const;
