import { runScreenerAgent } from '../agent/screenerAgent.js';
import { runPreFilter } from './preFilterService.js';
import { logger } from '../lib/logger.js';
import { emitProgress } from './runProgress.js';
const log = logger.child({ component: 'screener-orchestration' });
/**
 * Orchestrate the full screener pipeline:
 * universe → pre-filter → agent → persist
 *
 * Returns null gracefully if any stage is empty or missing.
 */
export async function runScreener(runId, settings, deps) {
    try {
        // 1. Guard: screener must be enabled
        if (!settings.screener?.enabled) {
            log.debug('screener is disabled');
            return null;
        }
        // 2. Guard: watchlist mode must be dynamic
        if (settings.watchlist?.mode !== 'dynamic') {
            log.debug('watchlist is not in dynamic mode');
            return null;
        }
        const dynamicConfig = settings.watchlist.dynamic;
        if (!dynamicConfig) {
            log.debug('no dynamic config');
            return null;
        }
        // 3. Pre-filter: deterministic quant filter
        emitProgress(runId, 'screener', 'Pre-filtering universe...', {});
        const preFilterConfig = {
            universes: dynamicConfig.universes,
            customSymbols: dynamicConfig.customSymbols,
            maxCandidates: dynamicConfig.maxCandidates,
            minPrice: dynamicConfig.minPrice,
            maxPrice: dynamicConfig.maxPrice,
            minVolume: dynamicConfig.minVolume,
            minMarketCap: dynamicConfig.minMarketCap,
        };
        const preFilterResult = await runPreFilter(preFilterConfig, deps.toolsDeps, runId);
        if (preFilterResult.candidates.length === 0) {
            log.warn('pre-filter returned zero candidates');
            return null;
        }
        log.debug('pre-filter complete', {
            candidates: preFilterResult.candidates.length,
            rejected: preFilterResult.rejected.length,
        });
        // 4. Screener agent: fetch data and rank candidates
        emitProgress(runId, 'screener', `Screening ${preFilterResult.candidates.length} candidates...`, {});
        const candidateList = preFilterResult.candidates.map((c) => ({ symbol: c.symbol }));
        const selections = await runScreenerAgent(runId, candidateList, deps.screenerAgentDeps, {
            model: settings.llm.agents?.screener?.model || undefined,
            temperature: settings.llm.temperature,
        });
        if (!selections || selections.length === 0) {
            log.warn('screener agent returned no selections');
            return null;
        }
        log.debug('screener agent complete', { selections: selections.length });
        // 5. Persist selections
        emitProgress(runId, 'screener', `Persisting ${selections.length} selections...`, {});
        for (const selection of selections) {
            const selectedJson = JSON.stringify({
                fundamentals: preFilterResult.candidates.find((c) => c.symbol === selection.symbol)
                    ?.fundamentals,
            });
            deps.screenerSelectionsRepo.create({
                runId,
                symbol: selection.symbol,
                rationale: selection.rationale,
                conviction: selection.conviction,
                selectedJson,
                rejectedJson: JSON.stringify(preFilterResult.rejected.filter((r) => r.symbol === selection.symbol)),
            });
        }
        log.debug('persisted selections', { count: selections.length });
        return {
            selections,
            candidates: preFilterResult.candidates,
        };
    }
    catch (err) {
        log.error('screener orchestration failed', {
            runId,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}
//# sourceMappingURL=screenerOrchestrationService.js.map