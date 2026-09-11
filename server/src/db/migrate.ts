import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  const isFreshDb = isFreshDatabase(db);

  if (isFreshDb) {
    // Fresh database: use complete schema.sql
    const schemaPath = path.join(migrationsDir, '..', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('Fresh database detected, applying complete schema...');
      const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
      db.exec(schemaSql);
      console.log('✓ Schema applied');
      return;
    }
    // Fall through to migrations if schema.sql doesn't exist
  }

  // Existing database: run incremental migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const migrations = loadMigrations(migrationsDir);

  const appliedStmt = db.prepare('SELECT version FROM schema_migrations ORDER BY version');
  const applied = new Set(
    (appliedStmt.all() as Array<{ version: number }>).map((row) => row.version)
  );

  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      console.log(`Running migration ${migration.version}: ${migration.name}`);

      try {
        db.exec(migration.sql);

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

function isFreshDatabase(db: Database.Database): boolean {
  try {
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).get();
    return !result;
  } catch {
    return true;
  }
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
