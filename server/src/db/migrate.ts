import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  // Create schema_migrations table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  // Get all migration files
  const migrations = loadMigrations(migrationsDir);

  // Get applied versions
  const appliedStmt = db.prepare('SELECT version FROM schema_migrations ORDER BY version');
  const applied = new Set(
    appliedStmt.all().map((row: { version: number }) => row.version)
  );

  // Run pending migrations
  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      console.log(`Running migration ${migration.version}: ${migration.name}`);

      try {
        db.exec(migration.sql);

        // Record migration
        const insertStmt = db.prepare(
          'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)'
        );
        insertStmt.run(migration.version, Date.now());

        console.log(`✓ Migration ${migration.version} applied`);
      } catch (error) {
        console.error(`✗ Migration ${migration.version} failed:`, error);
        throw error;
      }
    }
  }

  console.log('Migrations complete');
}

function loadMigrations(migrationsDir: string): Migration[] {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.match(/^\d+_.*\.sql$/))
    .sort();

  return files.map(file => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) throw new Error(`Invalid migration filename: ${file}`);

    const [, versionStr, name] = match;
    const version = parseInt(versionStr, 10);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    return { version, name, sql };
  });
}
