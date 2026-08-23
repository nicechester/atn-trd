import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'universe-loader' });

const __dirname = dirname(fileURLToPath(import.meta.url));

interface UniverseConfig {
  sp500: string[];
  nasdaq100: string[];
  russell2000: string[];
  tech: string[];
  healthcare: string[];
  commodity: string[];
  crypto: string[];
}

let cachedUniverse: UniverseConfig | null = null;

function loadUniverse(): UniverseConfig {
  if (cachedUniverse) {
    return cachedUniverse;
  }

  try {
    const sp500 = JSON.parse(
      readFileSync(join(__dirname, 'universe', 'sp500.json'), 'utf-8')
    ) as string[];
    const nasdaq100 = JSON.parse(
      readFileSync(join(__dirname, 'universe', 'nasdaq100.json'), 'utf-8')
    ) as string[];
    const russell2000 = JSON.parse(
      readFileSync(join(__dirname, 'universe', 'russell2000.json'), 'utf-8')
    ) as string[];
    const tech = JSON.parse(
      readFileSync(join(__dirname, 'universe', 'tech.json'), 'utf-8')
    ) as string[];
    const healthcare = JSON.parse(
      readFileSync(join(__dirname, 'universe', 'healthcare.json'), 'utf-8')
    ) as string[];
    const commodity = JSON.parse(
      readFileSync(join(__dirname, 'universe', 'commodity.json'), 'utf-8')
    ) as string[];
    const crypto = JSON.parse(
      readFileSync(join(__dirname, 'universe', 'crypto.json'), 'utf-8')
    ) as string[];

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
  } catch (err) {
    log.error('failed to load universe', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export function getUniverse(type: 'sp500' | 'nasdaq100' | 'russell2000' | 'tech' | 'healthcare' | 'commodity' | 'crypto' | 'custom', customSymbols?: string[]): string[] {
  const universe = loadUniverse();

  if (type === 'custom') {
    return customSymbols || [];
  }

  return universe[type] || [];
}
