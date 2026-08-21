/**
 * Static symbols that always get price data cached, regardless of user watchlist.
 * Used for sector ETFs (for sector performance tool) and benchmarks.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

interface StaticSymbolsConfig {
  sectorETFs: string[];
  benchmarks: string[];
}

let cached: StaticSymbolsConfig | null = null;

function loadConfig(): StaticSymbolsConfig {
  if (cached) return cached;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const configPath = join(__dirname, 'staticSymbols.json');
  const content = readFileSync(configPath, 'utf-8');
  cached = JSON.parse(content) as StaticSymbolsConfig;
  return cached;
}

/** All static symbols (sector ETFs + benchmarks) */
export function getStaticSymbols(): string[] {
  const config = loadConfig();
  return [...config.sectorETFs, ...config.benchmarks];
}

/** Just sector ETFs */
export function getSectorETFs(): string[] {
  return loadConfig().sectorETFs;
}

/** Just benchmarks */
export function getBenchmarks(): string[] {
  return loadConfig().benchmarks;
}
