import type { Database, Statement } from "sql.js";

export type SQLParam = string | number | bigint | ArrayBuffer | Uint8Array | null;
export type SQLParams = SQLParam[];

export class Helpers {
  static hasSqliteConnection(db: Database | null): boolean {
    return Boolean(db);
  }

  static runStatement(
    db: Database | null,
    sql: string,
    params: SQLParams = [],
  ): Promise<void> {
    if (!db) {
      return Promise.resolve();
    }

    const stmt = db.prepare(sql);
    try {
      Helpers.bindParams(stmt, params);
      stmt.step();
    } finally {
      stmt.free();
    }
    return Promise.resolve();
  }

  static queryOne<T extends Record<string, unknown>>(
    db: Database | null,
    sql: string,
    params: SQLParams = [],
  ): Promise<T | null> {
    if (!db) {
      return Promise.resolve(null);
    }

    const stmt = db.prepare(sql);
    try {
      Helpers.bindParams(stmt, params);
      if (!stmt.step()) {
        return Promise.resolve(null);
      }
      return Promise.resolve(stmt.getAsObject() as T);
    } finally {
      stmt.free();
    }
  }

  static queryAll<T extends Record<string, unknown>>(
    db: Database | null,
    sql: string,
    params: SQLParams = [],
  ): Promise<T[]> {
    if (!db) {
      return Promise.resolve([]);
    }

    const stmt = db.prepare(sql);
    const rows: T[] = [];
    try {
      Helpers.bindParams(stmt, params);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return Promise.resolve(rows);
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
type WriteDbFn = (data: Uint8Array) => Promise<void>;

export class SqlJsPersistenceManager {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private suspended = false;
  private pendingSaveWhileSuspended = false;

  constructor(
    private readonly getDb: GetDbFn,
    private readonly writeDb: WriteDbFn,
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
    if (!db) {
      return;
    }

    const data = db.export();
    await this.writeDb(data);
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
