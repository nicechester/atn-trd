import Database from 'better-sqlite3';
import syncFetch from 'sync-fetch';
import path from 'path';

const SQLITE_SERVICE_URL = process.env.SQLITE_SERVICE_URL;
const SQLITE_AUTH_TOKEN = process.env.DATA_API_KEY;

/**
 * HTTP client that mimics better-sqlite3's Database interface.
 * Uses sync-fetch so existing repo code works unchanged.
 */
class HttpDbClient {
  constructor(private url: string, private token: string) {}

  prepare(sql: string) {
    const self = this;
    return {
      run(...params: unknown[]) {
        return self.post('/exec/run', { sql, params });
      },
      get(...params: unknown[]) {
        return self.post('/exec/query', { sql, params }).rows?.[0];
      },
      all(...params: unknown[]) {
        return self.post('/exec/query', { sql, params }).rows ?? [];
      },
      iterate(...params: unknown[]) {
        const rows = self.post('/exec/query', { sql, params }).rows ?? [];
        return rows[Symbol.iterator]();
      },
      pluck() { return this; },
      expand() { return this; },
      raw() { return this; },
      bind() { return this; },
      columns() { return []; },
      safeIntegers() { return this; },
    };
  }

  exec(sql: string): this {
    this.post('/exec/run', { sql, params: [] });
    return this;
  }

  transaction<T>(fn: () => T): () => T {
    return fn;
  }

  pragma(_pragma: string): unknown { return undefined; }
  close(): void {}
  function() { return this; }
  aggregate() { return this; }
  loadExtension() { return this; }
  defaultSafeIntegers() { return this; }
  backup() { return Promise.resolve({ totalPages: 0, remainingPages: 0 }); }
  table() { return this; }
  unsafeMode() { return this; }
  serialize() { return Buffer.from(''); }

  get memory() { return false; }
  get readonly() { return false; }
  get name() { return 'http'; }
  get open() { return true; }
  get inTransaction() { return false; }

  private post(endpoint: string, body: object): any {
    const res = syncFetch(`${this.url}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`SQLite service error: ${res.status} ${res.statusText}`);
    return res.json();
  }
}

let db: Database.Database | null = null;

export function initializeDatabase(dataDir?: string): Database.Database {
  if (SQLITE_SERVICE_URL && SQLITE_AUTH_TOKEN) {
    console.log(`[DB] Using SQLite service at ${SQLITE_SERVICE_URL}`);
    db = new HttpDbClient(SQLITE_SERVICE_URL, SQLITE_AUTH_TOKEN) as unknown as Database.Database;
    return db;
  }

  if (!dataDir) throw new Error('dataDir required for local SQLite');
  const dbPath = path.join(dataDir, 'atn.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log(`[DB] Using local SQLite at ${dbPath}`);
  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initializeDatabase first.');
  return db;
}

export function closeDatabase(): void {
  if (db && typeof db.close === 'function') {
    db.close();
  }
  db = null;
}
