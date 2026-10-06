import { CashFlowsRepo } from '../repos/cashFlowsRepo.js';
import { notionalCents } from '../lib/money.js';
import { toETDateStr } from '../scheduler/marketCalendar.js';
import { logger } from '../lib/logger.js';
const log = logger.child({ component: 'portfolio-service' });
export class PortfolioServiceImpl {
    db;
    priceFeed;
    positionsRepo;
    portfolioRepo;
    cashFlowsRepo;
    constructor(db, priceFeed, positionsRepo, portfolioRepo) {
        this.db = db;
        this.priceFeed = priceFeed;
        this.positionsRepo = positionsRepo;
        this.portfolioRepo = portfolioRepo;
        this.cashFlowsRepo = new CashFlowsRepo(db);
    }
    async getPortfolio(opts) {
        const portfolio = this.portfolioRepo.read();
        if (!portfolio) {
            throw new Error('Portfolio not initialized');
        }
        const asOfDate = opts?.asOfDate || toETDateStr(new Date());
        const isHistorical = !!opts?.asOfDate;
        // First pass: compute position values
        const positions = this.positionsRepo.list(); // Only qty != 0
        const positionDetails = [];
        let positionsValueCents = 0;
        for (const pos of positions) {
            const currentPriceCents = await this.resolvePriceCents(pos.symbol, pos.avgCostCents, asOfDate, isHistorical);
            const costBasisCents = notionalCents(pos.qty, pos.avgCostCents);
            const marketValueCents = notionalCents(pos.qty, currentPriceCents);
            const unrealizedPnlCents = marketValueCents - costBasisCents;
            positionDetails.push({
                symbol: pos.symbol,
                qty: pos.qty,
                avgCostCents: pos.avgCostCents,
                currentPriceCents,
                costBasisCents,
                marketValueCents,
                weightPercent: 0, // Will be computed in second pass
                unrealizedPnlCents,
                realizedPnlCents: pos.realizedPnlCents,
            });
            positionsValueCents += marketValueCents;
        }
        // Total realized P&L: sum all realized P&L from all positions (including closed ones)
        const allPositions = this.positionsRepo.listAll();
        let totalRealizedPnlCents = 0;
        for (const pos of allPositions) {
            totalRealizedPnlCents += pos.realizedPnlCents;
        }
        // Compute total value
        const totalValueCents = portfolio.cashCents + positionsValueCents;
        // Second pass: compute weights
        for (const detail of positionDetails) {
            detail.weightPercent = totalValueCents > 0 ? (detail.marketValueCents / totalValueCents) * 100 : 0;
        }
        // Compute totals
        const totalUnrealizedPnlCents = positionDetails.reduce((sum, d) => sum + d.unrealizedPnlCents, 0);
        const totalPnlCents = totalUnrealizedPnlCents + totalRealizedPnlCents;
        const totalReturnPercent = portfolio.startingCashCents > 0
            ? (totalPnlCents / portfolio.startingCashCents) * 100
            : 0;
        return {
            asOfDate,
            cashCents: portfolio.cashCents,
            positionsValueCents,
            totalValueCents,
            totalUnrealizedPnlCents,
            totalRealizedPnlCents,
            totalPnlCents,
            totalReturnPercent,
            positions: positionDetails,
        };
    }
    async resetPaperAccount() {
        const portfolio = this.portfolioRepo.read();
        if (!portfolio) {
            throw new Error('Portfolio not initialized');
        }
        this.db.transaction(() => {
            this.positionsRepo.clear();
            this.portfolioRepo.write({
                cashCents: portfolio.startingCashCents,
                startingCashCents: portfolio.startingCashCents,
                startedAt: portfolio.startedAt,
                resetAt: Date.now(),
                baseCurrency: portfolio.baseCurrency,
            });
        })();
    }
    /**
     * Get the cost base (sum of deposits minus sum of withdrawals).
     * Used for performance calculation.
     * Falls back to starting_cash_cents for backward compatibility with old portfolios.
     * @param asOfDate - Optional historical date (YYYY-MM-DD)
     * @returns Cost base in cents
     */
    getCostBase(asOfDate) {
        const deposits = this.cashFlowsRepo.sumByType('deposit', asOfDate);
        const withdrawals = this.cashFlowsRepo.sumByType('withdrawal', asOfDate);
        const costBase = Math.max(0, deposits - withdrawals);
        // Backward compatibility: if no flows recorded, use starting_cash_cents
        if (costBase === 0 && deposits === 0 && withdrawals === 0) {
            const portfolio = this.portfolioRepo.read();
            if (portfolio) {
                return portfolio.startingCashCents;
            }
        }
        return costBase;
    }
    /**
     * Resolve current price for a symbol, handling live vs historical modes.
     * Live mode: getPrice -> getLatestBar -> avgCostCents (with warning)
     * Historical mode: getBar -> avgCostCents (with warning)
     */
    async resolvePriceCents(symbol, avgCostCents, asOfDate, isHistorical) {
        if (isHistorical) {
            // Historical mode: look for specific date bar
            const bar = await this.priceFeed.getBar(symbol, asOfDate);
            if (bar) {
                return bar.closeCents;
            }
            // Fallback to average cost
            log.warn('historical price not found, using average cost', { symbol, asOfDate });
            return avgCostCents;
        }
        // Live mode: try getPrice first
        const price = await this.priceFeed.getPrice(symbol);
        if (price !== null && price !== undefined) {
            const priceCents = Math.round(price * 100);
            return priceCents;
        }
        // Try getLatestBar as fallback
        const bar = await this.priceFeed.getLatestBar(symbol);
        if (bar) {
            return bar.closeCents;
        }
        // Final fallback to average cost
        log.warn('live price not found, using average cost', { symbol });
        return avgCostCents;
    }
}
//# sourceMappingURL=portfolioService.js.map