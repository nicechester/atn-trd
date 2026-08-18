import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database | null = null;

export function initializeDatabase(dataDir: string): Database.Database {
  const dbPath = path.join(dataDir, 'atn.db');

  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Enforce foreign keys
  db.pragma('foreign_keys = ON');

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
