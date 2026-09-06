import type { Decision, DecisionSet, Order } from '@atn-trd/shared';
import type { Portfolio } from './portfolioService.js';
/**
 * Interface for fetching live prices.
 */
export interface RiskPriceFeed {
    getPrice(symbol: string): Promise<number | null>;
}
/**
 * Risk guardrails for order sizing and filtering.
 */
export interface RiskConstraints {
    maxPositionWeightPercent: number;
    maxConcurrentPositions: number;
    maxNewPositionsPerRun: number;
    minCashReservePercent: number;
    maxOrderNotionalCents: number;
    minConfidenceThreshold: number;
    symbolBlocklist: string[];
    maxVolatility: number;
    broker: 'paper' | 'live';
}
/**
 * Details of sizing computation for debugging and logging.
 */
export interface SizingDetails {
    targetWeightDecimal: number;
    targetNotionalCents: number;
    currentNotionalCents: number;
    deltaNotionalCents: number;
    priceCents: number;
    rawQty: number;
    finalQty: number;
    cappedByWeight: boolean;
    cappedByNotional: boolean;
    cappedByCash: boolean;
    cappedByPosition: boolean;
}
/**
 * Order proposal with sizing details for audit trail.
 */
export interface OrderProposal {
    order: Omit<Order, 'id'>;
    sizingDetails: SizingDetails;
}
/**
 * Rejection of a decision due to guardrails or risk checks.
 */
export interface Rejection {
    decisionId?: string;
    symbol: string;
    action: Decision['action'];
    confidence: number;
    targetWeight?: number;
    reason: string;
}
/**
 * Input to the risk evaluation service.
 */
export interface RiskServiceInput {
    decisionSet: DecisionSet;
    portfolio: Portfolio;
    runId: string;
    earningsBlackoutSymbols?: Set<string>;
    volatilityBySymbol?: Map<string, number | null>;
}
/**
 * Output: accepted orders and rejections.
 */
export interface RiskServiceOutput {
    orders: OrderProposal[];
    rejections: Rejection[];
}
/**
 * Risk service interface.
 */
export interface RiskService {
    evaluate(input: RiskServiceInput): Promise<RiskServiceOutput>;
}
/**
 * Create a risk service instance.
 */
export declare function createRiskService(constraints: RiskConstraints, priceFeed: RiskPriceFeed): RiskService;
//# sourceMappingURL=riskService.d.ts.map