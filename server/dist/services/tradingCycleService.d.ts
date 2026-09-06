import type { RunsRepo } from '../repos/runsRepo.js';
import type { AssessmentsRepo } from '../repos/assessmentsRepo.js';
import type { DecisionsRepo } from '../repos/decisionsRepo.js';
import type { OrdersRepo } from '../repos/ordersRepo.js';
import type { WatchlistRepo } from '../repos/watchlistRepo.js';
import type { CalibrationRepo } from '../repos/calibrationRepo.js';
import type { PortfolioService } from './portfolioService.js';
import type { SemanticMemoryService } from './semanticMemoryService.js';
import type { Broker } from '../brokers/types.js';
import type { AnalystAgentDeps } from '../agent/analystAgent.js';
import type { RiskPriceFeed } from './riskService.js';
import type { Settings } from '@atn-trd/shared';
import type Database from 'better-sqlite3';
import type { SymbolAssessment } from '../agent/analystAgent.js';
import type { AgentToolsDeps } from '../agent/tools.js';
export interface EnhancedAssessment extends SymbolAssessment {
    finbertScore: number;
    finbertLabel: 'positive' | 'negative' | 'neutral';
    finbertConfidence: number;
}
export interface TradingCycleDeps {
    db: Database.Database;
    runsRepo: RunsRepo;
    assessmentsRepo: AssessmentsRepo;
    decisionsRepo: DecisionsRepo;
    ordersRepo: OrdersRepo;
    portfolioService: PortfolioService;
    broker: Broker;
    analystDeps: AnalystAgentDeps;
    priceFeed: RiskPriceFeed;
    getSettings: () => Settings;
    watchlistRepo: WatchlistRepo;
    calibrationRepo?: CalibrationRepo;
    semanticMemory?: SemanticMemoryService;
    screenerDeps?: {
        screenerSelectionsRepo: any;
        screenerAgentDeps: any;
        toolsDeps: AgentToolsDeps;
    };
    runScreener?: (runId: string, settings: Settings, deps: any) => Promise<any>;
}
export interface TradingCycleService {
    execute(trigger: 'scheduled' | 'manual'): Promise<void>;
}
export declare function createTradingCycleService(deps: TradingCycleDeps): TradingCycleService;
//# sourceMappingURL=tradingCycleService.d.ts.map