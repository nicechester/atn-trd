import { logger } from '../lib/logger.js';
import { getUniverse } from '../config/universeLoader.js';
import { runWithConcurrency } from '../lib/concurrency.js';
import type { AgentToolsDeps } from '../agent/tools.js';
import type { FundamentalsPayload } from '../datasources/fundamentals/yahooFundamentals.js';
import { emitProgress } from './runProgress.js';

const log = logger.child({ component: 'pre-filter' });

export interface PreFilterConfig {
  universes: ('sp500' | 'nasdaq100' | 'russell2000' | 'tech' | 'healthcare' | 'commodity' | 'crypto' | 'custom')[];
  customSymbols?: string[];
  maxCandidates: number;
  minPrice: number;
  maxPrice: number;
  minVolume: number;
  minMarketCap: number;
}

export interface PreFilterCandidate {
  symbol: string;
  fundamentals: FundamentalsPayload;
}

export interface PreFilterResult {
  candidates: PreFilterCandidate[];
  rejected: Array<{ symbol: string; reason: string }>;
}

const PREFILTER_CONCURRENCY = 5;

/**
 * Pre-filter the universe to ~30 quality candidates using deterministic quant criteria.
 * Drops symbols with missing data; doesn't propagate errors per symbol.
 */
export async function runPreFilter(
  config: PreFilterConfig,
  deps: AgentToolsDeps,
  runId?: string
): Promise<PreFilterResult> {
  // 1. Get universe symbols
  const symbols = getUniverse(config.universes, config.customSymbols);
  log.debug('loaded universe', { universes: config.universes, count: symbols.length });

  if (symbols.length === 0) {
    log.warn('empty universe');
    return { candidates: [], rejected: [] };
  }

  // 2. Fetch fundamentals with bounded concurrency, catching per-symbol failures
  const rejected: Array<{ symbol: string; reason: string }> = [];
  let processed = 0;
  const fundamentalsResults = await runWithConcurrency(
    symbols,
    PREFILTER_CONCURRENCY,
    async (symbol) => {
      try {
        const result = await deps.fundamentalsSource.fetch({ symbol });
        processed++;
        if (runId && processed % 10 === 0) {
          emitProgress(runId, 'screener', `Fetching fundamentals... ${processed}/${symbols.length}`, { symbol });
        }
        return { symbol, fundamentals: result.data };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        rejected.push({ symbol, reason });
        log.debug('fundamentals fetch failed', { symbol, reason });
        processed++;
        return null;
      }
    }
  );

  const withFundamentals = fundamentalsResults.filter(
    (r): r is { symbol: string; fundamentals: FundamentalsPayload } => r !== null
  );
  log.debug('fetched fundamentals', {
    total: symbols.length,
    success: withFundamentals.length,
    failed: rejected.length,
  });

  // 3. Apply quantitative filters
  const filtered = withFundamentals.filter((item) => {
    const { symbol, fundamentals } = item;
    const f = fundamentals;

    // Price filter
    if (f.price === null || f.price < config.minPrice || f.price > config.maxPrice) {
      rejected.push({
        symbol,
        reason: `price=${f.price} outside range [${config.minPrice}, ${config.maxPrice}]`,
      });
      return false;
    }

    // Volume filter
    if (f.averageVolume === null || f.averageVolume < config.minVolume) {
      rejected.push({
        symbol,
        reason: `averageVolume=${f.averageVolume} below ${config.minVolume}`,
      });
      return false;
    }

    // Market cap filter
    if (config.minMarketCap > 0) {
      if (f.marketCap === null || f.marketCap < config.minMarketCap) {
        rejected.push({
          symbol,
          reason: `marketCap=${f.marketCap} below ${config.minMarketCap}`,
        });
        return false;
      }
    }

    return true;
  });

  log.debug('applied quantitative filters', {
    before: withFundamentals.length,
    after: filtered.length,
  });

  // 4. Sort by market cap descending (favors larger, more liquid candidates)
  const sorted = filtered.sort((a, b) => {
    const capA = a.fundamentals.marketCap ?? 0;
    const capB = b.fundamentals.marketCap ?? 0;
    return capB - capA;
  });

  // 5. Truncate to max candidates
  const candidates = sorted.slice(0, config.maxCandidates);
  log.debug('pre-filter complete', {
    candidates: candidates.length,
    rejected: rejected.length,
  });

  return { candidates, rejected };
}
