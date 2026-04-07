export const SCHEMA_SQL = `
PRAGMA journal_mode=MEMORY;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT NOT NULL UNIQUE,
  mtime      INTEGER NOT NULL,
  size       INTEGER NOT NULL,
  title      TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_idx   INTEGER NOT NULL,
  content     TEXT NOT NULL,
  heading     TEXT,
  token_count INTEGER NOT NULL,
  embedding   BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_path   ON files(path);
CREATE INDEX IF NOT EXISTS idx_files_mtime  ON files(mtime);
CREATE INDEX IF NOT EXISTS idx_chunks_file  ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_order ON chunks(file_id, chunk_idx);
`;
