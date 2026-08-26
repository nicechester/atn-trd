import Database from 'better-sqlite3';
import syncFetch from 'sync-fetch';
import path from 'path';

const SQLITE_SERVICE_URL = process.env.SQLITE_SERVICE_URL;
const SQLITE_AUTH_TOKEN = process.env.DATA_API_KEY;

/**
 * HTTP client that mimics better-sqlite3's Database interface.
 * Uses sync HTTP via curl so existing repo code works unchanged.
 */
class HttpDbClient {
  constructor(private url: string, private token: string) {}

  prepare(sql: string) {
    const self = this;
    return {
      all(...params: unknown[]) {
        return self.post('/exec/query', { sql, params }).rows;
      },
      get(...params: unknown[]) {
        return self.post('/exec/query', { sql, params }).rows[0];
      },
      run(...params: unknown[]) {
        return self.post('/exec/run', { sql, params });
      },
    };
  }

  transaction<T>(fn: () => T): () => T {
    return fn;
  }

  exec(sql: string): this {
    this.post('/exec/run', { sql, params: [] });
    return this as any;
  }

  pragma(_pragma: string): unknown { return undefined; }
  close(): void {}

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
