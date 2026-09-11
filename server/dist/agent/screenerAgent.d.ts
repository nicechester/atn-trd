import type { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import type { ArtifactsRepo } from '../repos/artifactsRepo.js';
import type { YahooSectorPerformance } from '../datasources/sectors/index.js';
import type { FundamentalsDataSource } from '../datasources/fundamentals/index.js';
import type { OptionsDataSource } from '../datasources/options/index.js';
import type { RunCache } from '../datasources/cache.js';
export interface ScreenerSelection {
    symbol: string;
    rationale: string;
    conviction: number;
}
export interface ScreenerToolsDeps {
    sectorSource: YahooSectorPerformance;
    fundamentalsSource: FundamentalsDataSource;
    optionsSource: OptionsDataSource;
    cache: RunCache;
}
export interface ScreenerAgentDeps {
    toolsDeps: ScreenerToolsDeps;
    messagesRepo: AgentMessagesRepo;
    artifactsRepo: ArtifactsRepo;
}
export interface ScreenerAgentConfig {
    model?: string;
    temperature?: number;
}
/**
 * Run screener with all data passed in prompt - no tools needed.
 */
export declare function runScreenerAgent(runId: string, candidates: Array<{
    symbol: string;
}>, deps: ScreenerAgentDeps, _config?: ScreenerAgentConfig): Promise<ScreenerSelection[] | null>;
//# sourceMappingURL=screenerAgent.d.ts.map