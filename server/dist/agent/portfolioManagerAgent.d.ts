import type { SymbolAssessment } from './analystAgent.js';
import type { DecisionSet, InvestorProfile } from '@atn-trd/shared';
export interface PortfolioContext {
    cashPercent: number;
    currentPositions: string[];
    positionCount: number;
    positionWeights: Record<string, number>;
}
export interface PortfolioConstraints {
    maxPositionWeightPercent: number;
    maxConcurrentPositions: number;
    maxNewPositionsPerRun: number;
    minCashReservePercent: number;
    minConfidenceThreshold: number;
    symbolBlocklist: string[];
    investorProfile?: InvestorProfile;
}
export interface PortfolioManagerAgentConfig {
    model?: string;
    temperature?: number;
}
export declare function runPortfolioManagerAgent(runId: string, assessments: SymbolAssessment[], portfolioContext: PortfolioContext, constraints: PortfolioConstraints, config?: PortfolioManagerAgentConfig): Promise<DecisionSet | null>;
//# sourceMappingURL=portfolioManagerAgent.d.ts.map