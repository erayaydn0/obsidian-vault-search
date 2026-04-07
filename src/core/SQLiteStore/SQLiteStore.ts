import type { App } from "obsidian";
import type { Database } from "sql.js";

import {
  DB_DIR,
  DB_FILENAME,
  EMBEDDING_DIMENSION,
  SCHEMA_VERSION,
} from "../../constants";
import { bundledSqlJsWasm } from "../../sqlJsBundled";
import { initSqlJs } from "../../sqlJsRuntime";
import type {
  Chunk,
  IndexedDocument,
  IndexedFile,
  IndexStats,
  IndexStatus,
  ParsedFile,
  VaultSearchSettings,
} from "../../types";
import { SQLiteCacheManager } from "./cacheManager";
import {
  Helpers,
  SqlJsPersistenceManager,
  type SQLParams,
} from "./helpers";
import { SCHEMA_SQL } from "./schema";
import { SQLiteSearchOps } from "./searchOps";
import { buildStats } from "./statsOps";
import type {
  ChunkLookupEntry,
  EmbeddingCacheEntry,
} from "./storeTypes";
import { SQLiteWriteOps } from "./writeOps";

export class SQLiteStore {
  private readonly app: App;
  private settings: VaultSearchSettings;
  private databasePath = "";
  private db: Database | null = null;
  private initialized = false;
  private status: IndexStatus = "initializing";
  private lastFullIndex: number | null = null;
  private bulkIndexDepth = 0;
  private readonly persistence = new SqlJsPersistenceManager(
    () => this.db,
    async (data) => {
      if (!this.databasePath) return;
      // Adapter API expects ArrayBuffer; copy into a fresh one so sql.js's
      // backing buffer is not mutated underneath us.
      const buffer = data.slice().buffer;
      await this.app.vault.adapter.writeBinary(this.databasePath, buffer);
    },
  );

  // In-memory embedding cache for fast cosine search
  private embeddingCache: EmbeddingCacheEntry[] = [];

  // In-memory document store (used when SQLite is unavailable / in tests)
  private documents = new Map<string, IndexedDocument>();
  private nextFileId = 1;
  private nextChunkId = 1;
  private chunkLookup = new Map<number, ChunkLookupEntry>();
  private fileChunkIds = new Map<number, Set<number>>();
  private readonly cacheManager = new SQLiteCacheManager(
    this.documents,
    this.embeddingCache,
    this.chunkLookup,
    this.fileChunkIds,
    (value) => {
      this.nextFileId = value;
    },
    (value) => {
      this.nextChunkId = value;
    },
  );
  private readonly writeOps = new SQLiteWriteOps(
    this.documents,
    this.embeddingCache,
    (fileId) => this.cacheManager.removeFromEmbeddingCache(fileId),
    (path) => this.cacheManager.updateChunkLookup(path),
    (fileId) => this.cacheManager.removeChunkLookupForFile(fileId),
    (sql, params) => this.run(sql, params),
    <T extends Record<string, unknown>>(
      sql: string,
      params?: (string | number | bigint | ArrayBuffer | Uint8Array | null)[],
    ) => Helpers.queryOne<T>(this.db, sql, params),
  );
  public readonly searchOps = new SQLiteSearchOps(
    () => this.documents.values(),
    () => this.embeddingCache,
    () => this.chunkLookup,
    () =>
      this.cacheManager.buildFilePathMap(
        (sql, params) => Helpers.queryAll(this.db, sql, params),
        Helpers.hasSqliteConnection(this.db),
      ),
  );

  constructor(app: App, settings: VaultSearchSettings) {
    this.app = app;
    this.settings = settings;
  }

  /** Copy — Emscripten may mutate the backing buffer. */
  private static copyWasm(bytes: Uint8Array): Uint8Array {
    return Uint8Array.from(bytes);
  }

  async initialize(): Promise<void> {
    this.status = "initializing";
    const adapter = this.app.vault.adapter;

    if (!(await adapter.exists(DB_DIR))) {
      await adapter.mkdir(DB_DIR);
    }
    if (!(await adapter.exists(this.settings.modelCacheDir))) {
      await adapter.mkdir(this.settings.modelCacheDir);
    }

    this.databasePath = `${DB_DIR}/${DB_FILENAME}`;

    try {
      await this.openDatabase();
      await this.migrate();
      await this.cacheManager.loadDocumentsFromDb(
        (sql, params) => Helpers.queryAll(this.db, sql, params),
        Helpers.hasSqliteConnection(this.db),
      );
      this.initialized = true;
      this.status = "idle";
    } catch (err) {
      console.error("[VaultSearch] SQLiteStore init failed:", err);
      this.status = "error";
      this.db = null;
      this.initialized = true;
    }
  }

  private async openDatabase(): Promise<void> {
    const SQL = await initSqlJs({
      wasmBinary: SQLiteStore.copyWasm(bundledSqlJsWasm) as unknown as ArrayBuffer,
    });

    const adapter = this.app.vault.adapter;
    if (await adapter.exists(this.databasePath)) {
      const persisted = await adapter.readBinary(this.databasePath);
      this.db = new SQL.Database(new Uint8Array(persisted));
    } else {
      this.db = new SQL.Database();
    }
  }

  private async migrate(): Promise<void> {
    const db = this.db;

    if (!db) {
      return;
    }

    // Always apply DDL first — all statements use IF NOT EXISTS so this is safe on an
    // existing database and essential on a fresh one (meta table doesn't exist yet).
    db.run(SCHEMA_SQL);

    const versionRow = await Helpers.queryOne<{ value: string }>(
      this.db,
      "SELECT value FROM meta WHERE key = 'schema_version'",
    );
    const currentVersion = versionRow ? parseInt(versionRow.value, 10) : 0;

    if (currentVersion < SCHEMA_VERSION) {
      await this.run(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)",
        [String(SCHEMA_VERSION)],
      );
    }

    // Load persisted lastFullIndex
    const lastIndexRow = await Helpers.queryOne<{ value: string }>(
      this.db,
      "SELECT value FROM meta WHERE key = 'last_full_index'",
    );
    if (lastIndexRow) {
      this.lastFullIndex = parseInt(lastIndexRow.value, 10) || null;
    }

    // Detect model name mismatch → full rebuild needed
    const modelRow = await Helpers.queryOne<{ value: string }>(
      this.db,
      "SELECT value FROM meta WHERE key = 'model_name'",
    );
    if (modelRow && modelRow.value !== this.settings.modelName) {
      await this.clearAllData();
    }
    await this.run(
      "INSERT OR REPLACE INTO meta(key, value) VALUES ('model_name', ?)",
      [this.settings.modelName],
    );
  }

  async close(): Promise<void> {
    this.persistence.cancelPending();
    await this.persistence.flush();

    if (this.db) {
      try {
        this.db.close();
      } catch (_) {
        // ignore
      }
    }

    this.db = null;
    this.status = "idle";
  }

  async applySettings(newSettings: VaultSearchSettings): Promise<void> {
    const modelChanged = newSettings.modelName !== this.settings.modelName;
    this.settings = newSettings;
    if (modelChanged && this.initialized) {
      await this.clearAllData();
      await this.run(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('model_name', ?)",
        [newSettings.modelName],
      );
    }
  }

  getDatabasePath(): string {
    return this.databasePath;
  }

  markLastFullIndex(timestamp = Date.now()): void {
    this.lastFullIndex = timestamp;
    void this.run(
      "INSERT OR REPLACE INTO meta(key, value) VALUES ('last_full_index', ?)",
      [String(timestamp)],
    );
  }

  setStatus(status: IndexStatus): void {
    this.status = status;
  }

  beginBulkIndex(): void {
    this.bulkIndexDepth += 1;
    if (this.bulkIndexDepth === 1) {
      this.persistence.suspend();
    }
  }

  async endBulkIndex(): Promise<void> {
    if (this.bulkIndexDepth === 0) {
      return;
    }
    this.bulkIndexDepth -= 1;
    if (this.bulkIndexDepth === 0) {
      await this.persistence.resumeAndFlushIfNeeded();
    }
  }

  getIndexedPaths(): Set<string> {
    if (Helpers.hasSqliteConnection(this.db)) {
      // Sync path not available — callers should use getIndexedPathsAsync if SQLite is active.
      // For backwards-compat, fall through to in-memory store.
    }
    return new Set(this.documents.keys());
  }

  async getIndexedPathsAsync(): Promise<Set<string>> {
    if (!Helpers.hasSqliteConnection(this.db)) {
      return this.getIndexedPaths();
    }
    const rows = await Helpers.queryAll<{ path: string }>(
      this.db,
      "SELECT path FROM files",
    );
    return new Set(rows.map((r) => r.path));
  }

  hasFileChanged(path: string, mtime: number): boolean {
    const doc = this.documents.get(path);
    return !doc || doc.file.mtime !== mtime;
  }

  async hasFileChangedAsync(path: string, mtime: number): Promise<boolean> {
    if (!Helpers.hasSqliteConnection(this.db)) {
      return this.hasFileChanged(path, mtime);
    }
    const row = await Helpers.queryOne<{ mtime: number }>(
      this.db,
      "SELECT mtime FROM files WHERE path = ?",
      [path],
    );
    return !row || row.mtime !== mtime;
  }

  async getFileByPath(path: string): Promise<IndexedFile | null> {
    if (!Helpers.hasSqliteConnection(this.db)) {
      return this.documents.get(path)?.file ?? null;
    }

    const row = await Helpers.queryOne<{
      id: number;
      path: string;
      mtime: number;
      size: number;
      title: string;
      indexed_at: number;
    }>(
      this.db,
      "SELECT id, path, mtime, size, title, indexed_at FROM files WHERE path = ?",
      [path],
    );

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      path: row.path,
      mtime: row.mtime,
      size: row.size,
      title: row.title,
      indexedAt: row.indexed_at,
    };
  }

  async getIndexedEntry(path: string): Promise<IndexedDocument | null> {
    if (!Helpers.hasSqliteConnection(this.db)) {
      return this.documents.get(path) ?? null;
    }

    const file = await this.getFileByPath(path);
    if (!file) {
      return null;
    }

    const chunkRows = await Helpers.queryAll<{
      id: number;
      chunk_idx: number;
      content: string;
      heading: string | null;
      token_count: number;
    }>(
      this.db,
      "SELECT id, chunk_idx, content, heading, token_count FROM chunks WHERE file_id = ? ORDER BY chunk_idx",
      [file.id],
    );

    const chunks: Chunk[] = chunkRows.map((row) => ({
      id: row.id,
      fileId: file.id,
      chunkIdx: row.chunk_idx,
      content: row.content,
      heading: row.heading,
      tokenCount: row.token_count,
      embedding: new Float32Array(EMBEDDING_DIMENSION),
    }));

    return { file, chunks, frontmatter: {} };
  }

  async upsertFile(
    parsedFile: ParsedFile,
    fileMeta: { mtime: number; size: number },
    embeddings: Float32Array[],
  ): Promise<void> {
    const state = this.writeOps.upsertInMemory(
      parsedFile,
      fileMeta,
      embeddings,
      this.nextFileId,
      this.nextChunkId,
    );
    this.nextFileId = state.nextFileId;
    this.nextChunkId = state.nextChunkId;

    // Persist to SQLite if available
    if (!Helpers.hasSqliteConnection(this.db)) {
      return;
    }
    await this.writeOps.persistUpsert(parsedFile, fileMeta, embeddings);

  }

  async removeFile(path: string): Promise<void> {
    this.writeOps.removeInMemory(path);

    if (!Helpers.hasSqliteConnection(this.db)) {
      return;
    }
    await this.run("DELETE FROM files WHERE path = ?", [path]);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    this.writeOps.renameInMemory(oldPath, newPath);

    if (!Helpers.hasSqliteConnection(this.db)) {
      return;
    }
    await this.run("UPDATE files SET path = ? WHERE path = ?", [
      newPath,
      oldPath,
    ]);
  }

  async clearAllData(): Promise<void> {
    this.documents.clear();
    this.chunkLookup.clear();
    this.fileChunkIds.clear();
    this.embeddingCache = [];
    this.lastFullIndex = null;
    this.nextFileId = 1;
    this.nextChunkId = 1;

    if (!Helpers.hasSqliteConnection(this.db)) {
      return;
    }
    await this.run("DELETE FROM meta WHERE key NOT IN ('schema_version')");
    await this.run("DELETE FROM chunks");
    await this.run("DELETE FROM files");
  }

  async listDocuments(): Promise<IndexedDocument[]> {
    if (!Helpers.hasSqliteConnection(this.db)) {
      return [...this.documents.values()];
    }

    const fileRows = await Helpers.queryAll<{
      id: number;
      path: string;
      mtime: number;
      size: number;
      title: string;
      indexed_at: number;
    }>(
      this.db,
      "SELECT id, path, mtime, size, title, indexed_at FROM files ORDER BY path",
    );

    const docs: IndexedDocument[] = [];
    for (const fileRow of fileRows) {
      const chunkRows = await Helpers.queryAll<{
        id: number;
        chunk_idx: number;
        content: string;
        heading: string | null;
        token_count: number;
      }>(
        this.db,
        "SELECT id, chunk_idx, content, heading, token_count FROM chunks WHERE file_id = ? ORDER BY chunk_idx",
        [fileRow.id],
      );

      docs.push({
        file: {
          id: fileRow.id,
          path: fileRow.path,
          mtime: fileRow.mtime,
          size: fileRow.size,
          title: fileRow.title,
          indexedAt: fileRow.indexed_at,
        },
        chunks: chunkRows.map((c) => ({
          id: c.id,
          fileId: fileRow.id,
          chunkIdx: c.chunk_idx,
          content: c.content,
          heading: c.heading,
          tokenCount: c.token_count,
          embedding: new Float32Array(EMBEDDING_DIMENSION),
        })),
        frontmatter: {},
      });
    }

    return docs;
  }

  async getStats(): Promise<IndexStats> {
    return buildStats({
      documents: this.documents,
      hasSqlite: Helpers.hasSqliteConnection(this.db),
      queryOne: (sql, params) => Helpers.queryOne(this.db, sql, params),
      getDbSizeBytes: async () => {
        if (!this.databasePath) return 0;
        const stat = await this.app.vault.adapter.stat(this.databasePath);
        return stat?.size ?? 0;
      },
      lastFullIndex: this.lastFullIndex,
      modelName: this.settings.modelName,
      status: this.status,
    });
  }

  // ─── Low-level SQLite helpers ─────────────────────────────────────────────

  private async run(
    sql: string,
    params: SQLParams = [],
  ): Promise<void> {
    await Helpers.runStatement(this.db, sql, params);
    this.persistence.scheduleSave();
  }

}
