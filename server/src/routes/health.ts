import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from '../db/index.js';
import { isFinBERTReady } from '../services/finbertService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getAppVersion(): string {
  const candidates = [
    path.join(process.cwd(), 'package.json'),           // root when run from project
    path.join(process.cwd(), 'server', 'package.json'), // server workspace
    path.join(__dirname, '..', 'package.json'),         // bundled: dist/../package.json
    path.join(__dirname, '..', '..', 'package.json'),   // dev: src/routes/../../package.json
  ];
  for (const pkgPath of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch { /* try next */ }
  }
  return 'unknown';
}

function getBuildInfo(): { commit: string; buildTime: string; buildNumber?: number } | null {
  try {
    const buildPath = path.join(__dirname, '..', '..', 'build-info.json');
    const info = JSON.parse(fs.readFileSync(buildPath, 'utf-8'));
    return info;
  } catch {
    return null;
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
    build: getBuildInfo(),
    migrationVersion: getMigrationVersion(),
    db: getDbInfo(),
    encKeyPresent: Boolean(process.env.ATN_ENC_KEY),
    finbertReady: isFinBERTReady(),
    uptime: process.uptime(),
  });
}
