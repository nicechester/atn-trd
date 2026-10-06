/**
 * Static symbols that always get price data cached, regardless of user watchlist.
 * Used for sector ETFs (for sector performance tool) and benchmarks.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
let cached = null;
function loadConfig() {
    if (cached)
        return cached;
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const configPath = join(__dirname, 'staticSymbols.json');
    const content = readFileSync(configPath, 'utf-8');
    cached = JSON.parse(content);
    return cached;
}
/** All static symbols (sector ETFs + benchmarks) */
export function getStaticSymbols() {
    const config = loadConfig();
    return [...config.sectorETFs, ...config.benchmarks];
}
/** Just sector ETFs */
export function getSectorETFs() {
    return loadConfig().sectorETFs;
}
/** Just benchmarks */
export function getBenchmarks() {
    return loadConfig().benchmarks;
}
//# sourceMappingURL=staticSymbols.js.map