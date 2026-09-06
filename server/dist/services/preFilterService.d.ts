import type { AgentToolsDeps } from '../agent/tools.js';
import type { FundamentalsPayload } from '../datasources/fundamentals/yahooFundamentals.js';
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
    rejected: Array<{
        symbol: string;
        reason: string;
    }>;
}
/**
 * Pre-filter the universe to ~30 quality candidates using deterministic quant criteria.
 * Drops symbols with missing data; doesn't propagate errors per symbol.
 */
export declare function runPreFilter(config: PreFilterConfig, deps: AgentToolsDeps, runId?: string): Promise<PreFilterResult>;
//# sourceMappingURL=preFilterService.d.ts.map