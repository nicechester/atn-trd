import { DynamicStructuredTool } from '@langchain/core/tools';
import type { NewsDataSource } from '../datasources/news/index.js';
import type { FundamentalsDataSource } from '../datasources/fundamentals/index.js';
import type { MacroDataSource } from '../datasources/macro/index.js';
import type { OptionsDataSource } from '../datasources/options/index.js';
import type { YahooSectorPerformance } from '../datasources/sectors/index.js';
import type { PricesRepo } from '../repos/pricesRepo.js';
import type { PortfolioService } from '../services/portfolioService.js';
import type { DecisionsRepo } from '../repos/decisionsRepo.js';
import type { SemanticMemoryService } from '../services/semanticMemoryService.js';
import type { RunCache } from '../datasources/cache.js';
export interface AgentToolsDeps {
    newsSource: NewsDataSource;
    fundamentalsSource: FundamentalsDataSource;
    macroSource: MacroDataSource;
    optionsSource: OptionsDataSource;
    sectorSource: YahooSectorPerformance;
    pricesRepo: PricesRepo;
    portfolioService: PortfolioService;
    decisionsRepo: DecisionsRepo;
    cache: RunCache;
    semanticMemory?: SemanticMemoryService;
    llmLimits?: {
        maxNewsArticles: number;
        maxNewsDays: number;
        truncateNewsSummary: number;
    };
}
export declare function createAgentTools(deps: AgentToolsDeps): DynamicStructuredTool<import("@langchain/core/tools").ToolSchemaBase, any, any, any, unknown, string>[];
/**
 * Prefetch datasources concurrently to warm the cache before agent runs.
 * Failures are silently ignored - agent tools will retry if needed.
 */
export declare function prefetchForSymbol(symbol: string, deps: AgentToolsDeps): Promise<void>;
//# sourceMappingURL=tools.d.ts.map