import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database | null = null;

export function initializeDatabase(dataDir: string): Database.Database {
  const dbPath = path.join(dataDir, 'atn.db');

  db = new Database(dbPath);

  // Enable trace logging for all SQL statements
  try {
    let lastSql = '';
    let lastTime = 0;
    (db as any).trace((sql: string) => {
      const now = Date.now();
      const duration = lastTime ? now - lastTime : 0;
      if (lastSql) {
        console.log(`[DB] SQL executed in ${duration}ms: ${lastSql.substring(0, 120)}`);
      }
      lastSql = sql;
      lastTime = now;
    });
  } catch (err) {
    console.log(`[DB] Warning: Could not enable SQL tracing:`, err instanceof Error ? err.message : String(err));
  }

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Enforce foreign keys
  db.pragma('foreign_keys = ON');

  console.log(`[DB] Database initialized at ${dbPath}`);
  console.log(`[DB] Tracing enabled for SQL statements`);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
