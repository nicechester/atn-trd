import type { Settings } from '@atn-trd/shared';
import type { ScreenerSelectionsRepo } from '../repos/screenerSelectionsRepo.js';
import type { ScreenerAgentDeps, ScreenerSelection } from '../agent/screenerAgent.js';
import type { PreFilterCandidate } from './preFilterService.js';
import type { AgentToolsDeps } from '../agent/tools.js';
export interface ScreenerOrchestrationDeps {
    screenerSelectionsRepo: ScreenerSelectionsRepo;
    screenerAgentDeps: ScreenerAgentDeps;
    toolsDeps: AgentToolsDeps;
}
export interface ScreenerResult {
    selections: ScreenerSelection[];
    candidates: PreFilterCandidate[];
}
/**
 * Orchestrate the full screener pipeline:
 * universe → pre-filter → agent → persist
 *
 * Returns null gracefully if any stage is empty or missing.
 */
export declare function runScreener(runId: string, settings: Settings, deps: ScreenerOrchestrationDeps): Promise<ScreenerResult | null>;
//# sourceMappingURL=screenerOrchestrationService.d.ts.map