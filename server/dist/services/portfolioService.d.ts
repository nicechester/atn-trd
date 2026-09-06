import type Database from 'better-sqlite3';
import type { PriceFeed } from './priceService.js';
import type { PositionsRepo } from '../repos/positionsRepo.js';
import type { PortfolioRepo } from '../repos/portfolioRepo.js';
/**
 * Detailed information about a single position.
 */
export interface PositionDetail {
    symbol: string;
    qty: number;
    avgCostCents: number;
    currentPriceCents: number;
    costBasisCents: number;
    marketValueCents: number;
    weightPercent: number;
    unrealizedPnlCents: number;
    realizedPnlCents: number;
}
/**
 * Complete portfolio state with cash, positions, and totals.
 */
export interface Portfolio {
    asOfDate: string;
    cashCents: number;
    positionsValueCents: number;
    totalValueCents: number;
    totalUnrealizedPnlCents: number;
    totalRealizedPnlCents: number;
    totalPnlCents: number;
    totalReturnPercent: number;
    positions: PositionDetail[];
}
/**
 * Options for getting portfolio state.
 */
export interface GetPortfolioOptions {
    asOfDate?: string;
}
/**
 * Service for computing portfolio state including NAV, position values, weights, and P&L.
 */
export interface PortfolioService {
    /**
     * Compute live or historical portfolio state.
     * @param opts.asOfDate - Optional historical date (YYYY-MM-DD). If not provided, uses live prices.
     */
    getPortfolio(opts?: GetPortfolioOptions): Promise<Portfolio>;
    /**
     * Clear all positions and restore cash to starting amount.
     */
    resetPaperAccount(): Promise<void>;
    /**
     * Get the cost base (sum of deposits minus sum of withdrawals).
     * Used for performance calculation.
     * @param asOfDate - Optional historical date (YYYY-MM-DD)
     * @returns Cost base in cents
     */
    getCostBase(asOfDate?: string): number;
}
export declare class PortfolioServiceImpl implements PortfolioService {
    private readonly db;
    private readonly priceFeed;
    private readonly positionsRepo;
    private readonly portfolioRepo;
    private readonly cashFlowsRepo;
    constructor(db: Database.Database, priceFeed: PriceFeed, positionsRepo: PositionsRepo, portfolioRepo: PortfolioRepo);
    getPortfolio(opts?: GetPortfolioOptions): Promise<Portfolio>;
    resetPaperAccount(): Promise<void>;
    /**
     * Get the cost base (sum of deposits minus sum of withdrawals).
     * Used for performance calculation.
     * Falls back to starting_cash_cents for backward compatibility with old portfolios.
     * @param asOfDate - Optional historical date (YYYY-MM-DD)
     * @returns Cost base in cents
     */
    getCostBase(asOfDate?: string): number;
    /**
     * Resolve current price for a symbol, handling live vs historical modes.
     * Live mode: getPrice -> getLatestBar -> avgCostCents (with warning)
     * Historical mode: getBar -> avgCostCents (with warning)
     */
    private resolvePriceCents;
}
//# sourceMappingURL=portfolioService.d.ts.map