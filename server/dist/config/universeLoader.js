import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { logger } from '../lib/logger.js';
const log = logger.child({ component: 'universe-loader' });
const __dirname = dirname(fileURLToPath(import.meta.url));
let cachedUniverse = null;
function loadUniverse() {
    if (cachedUniverse) {
        return cachedUniverse;
    }
    try {
        const sp500 = JSON.parse(readFileSync(join(__dirname, 'universe', 'sp500.json'), 'utf-8'));
        const nasdaq100 = JSON.parse(readFileSync(join(__dirname, 'universe', 'nasdaq100.json'), 'utf-8'));
        const russell2000 = JSON.parse(readFileSync(join(__dirname, 'universe', 'russell2000.json'), 'utf-8'));
        const tech = JSON.parse(readFileSync(join(__dirname, 'universe', 'tech.json'), 'utf-8'));
        const healthcare = JSON.parse(readFileSync(join(__dirname, 'universe', 'healthcare.json'), 'utf-8'));
        const commodity = JSON.parse(readFileSync(join(__dirname, 'universe', 'commodity.json'), 'utf-8'));
        const crypto = JSON.parse(readFileSync(join(__dirname, 'universe', 'crypto.json'), 'utf-8'));
        cachedUniverse = { sp500, nasdaq100, russell2000, tech, healthcare, commodity, crypto };
        log.debug('loaded universes', {
            sp500Count: sp500.length,
            nasdaq100Count: nasdaq100.length,
            russell2000Count: russell2000.length,
            techCount: tech.length,
            healthcareCount: healthcare.length,
            commodityCount: commodity.length,
            cryptoCount: crypto.length,
        });
        return cachedUniverse;
    }
    catch (err) {
        log.error('failed to load universe', { error: err instanceof Error ? err.message : String(err) });
        throw err;
    }
}
export function getUniverse(types, customSymbols) {
    const universe = loadUniverse();
    const merged = new Set();
    for (const type of types) {
        if (type === 'custom') {
            (customSymbols || []).forEach(s => merged.add(s));
        }
        else {
            (universe[type] || []).forEach(s => merged.add(s));
        }
    }
    return Array.from(merged);
}
//# sourceMappingURL=universeLoader.js.map