import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from '../db/index.js';
import { isFinBERTReady } from '../services/finbertService.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function getAppVersion() {
    try {
        const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.version ?? 'unknown';
    }
    catch {
        return 'unknown';
    }
}
function getBuildInfo() {
    try {
        const buildPath = path.join(__dirname, '..', '..', 'build-info.json');
        const info = JSON.parse(fs.readFileSync(buildPath, 'utf-8'));
        return info;
    }
    catch {
        return null;
    }
}
function getMigrationVersion() {
    try {
        const db = getDatabase();
        const row = db
            .prepare('SELECT MAX(version) as version FROM schema_migrations')
            .get();
        return row?.version ?? null;
    }
    catch {
        return null;
    }
}
function getDbInfo() {
    try {
        const db = getDatabase();
        const dbPath = db.name;
        const stats = fs.statSync(dbPath);
        return { path: dbPath, size: stats.size };
    }
    catch {
        return null;
    }
}
export function healthHandler(_req, res) {
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
//# sourceMappingURL=health.js.map