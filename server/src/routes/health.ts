import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getAppVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function getMigrationVersion(): number | null {
  try {
    const db = getDatabase();
    const row = db
      .prepare('SELECT MAX(version) as version FROM schema_migrations')
      .get() as { version: number | null } | undefined;
    return row?.version ?? null;
  } catch {
    return null;
  }
}

function getDbInfo(): { path: string; size: number } | null {
  try {
    const db = getDatabase();
    const dbPath = db.name;
    const stats = fs.statSync(dbPath);
    return { path: dbPath, size: stats.size };
  } catch {
    return null;
  }
}

export function healthHandler(_req: Request, res: Response): void {
  res.json({
    version: getAppVersion(),
    migrationVersion: getMigrationVersion(),
    db: getDbInfo(),
    encKeyPresent: Boolean(process.env.ATN_ENC_KEY),
    uptime: process.uptime(),
  });
}
