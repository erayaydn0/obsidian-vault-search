import { writeFile as writeFileFs } from "fs/promises";
import type { Database, Statement } from "sql.js";

export type SQLParam = string | number | bigint | ArrayBuffer | Uint8Array | null;
export type SQLParams = SQLParam[];

export class Helpers {
  static hasSqliteConnection(db: Database | null): boolean {
    return Boolean(db);
  }

  static async runStatement(
    db: Database | null,
    sql: string,
    params: SQLParams = [],
  ): Promise<void> {
    if (!db) {
      return;
    }

    const stmt = db.prepare(sql);
    try {
      Helpers.bindParams(stmt, params);
      stmt.step();
    } finally {
      stmt.free();
    }
  }

  static async queryOne<T extends Record<string, unknown>>(
    db: Database | null,
    sql: string,
    params: SQLParams = [],
  ): Promise<T | null> {
    if (!db) {
      return null;
    }

    const stmt = db.prepare(sql);
    try {
      Helpers.bindParams(stmt, params);
      if (!stmt.step()) {
        return null;
      }
      return stmt.getAsObject() as T;
    } finally {
      stmt.free();
    }
  }

  static async queryAll<T extends Record<string, unknown>>(
    db: Database | null,
    sql: string,
    params: SQLParams = [],
  ): Promise<T[]> {
    if (!db) {
      return [];
    }

    const stmt = db.prepare(sql);
    const rows: T[] = [];
    try {
      Helpers.bindParams(stmt, params);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private static bindParams(stmt: Statement, params: SQLParams): void {
    if (params.length === 0) {
      return;
    }

    stmt.bind(
      params.map((value) => {
        if (typeof value === "bigint") {
          return Number(value);
        }
        if (value instanceof ArrayBuffer) {
          return new Uint8Array(value);
        }
        return value;
      }),
    );
  }
}

type GetDbFn = () => Database | null;
type GetPathFn = () => string;

export class SqlJsPersistenceManager {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private suspended = false;
  private pendingSaveWhileSuspended = false;

  constructor(
    private readonly getDb: GetDbFn,
    private readonly getDatabasePath: GetPathFn,
  ) {}

  scheduleSave(): void {
    if (!this.getDb()) {
      return;
    }
    if (this.suspended) {
      this.pendingSaveWhileSuspended = true;
      return;
    }

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 2000);
  }

  cancelPending(): void {
    if (!this.saveTimer) {
      return;
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  async flush(): Promise<void> {
    const db = this.getDb();
    const databasePath = this.getDatabasePath();
    if (!db || !databasePath) {
      return;
    }

    const data = db.export();
    await writeFileFs(databasePath, Buffer.from(data));
  }

  suspend(): void {
    this.suspended = true;
    this.cancelPending();
  }

  async resumeAndFlushIfNeeded(): Promise<void> {
    this.suspended = false;
    if (!this.pendingSaveWhileSuspended) {
      return;
    }
    this.pendingSaveWhileSuspended = false;
    await this.flush();
  }
}
