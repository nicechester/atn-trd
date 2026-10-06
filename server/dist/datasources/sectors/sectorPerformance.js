/**
 * Sector performance data source.
 *
 * Uses cached price bars from the database (populated by Finnhub backfill).
 * No external API calls - requires price bars to be pre-populated.
 */
import { BaseDataSource } from '../types.js';
import { logger } from '../../lib/logger.js';
const log = logger.child({ component: 'sector-performance' });
export const SECTORS_SOURCE = 'sectors';
export const HEALTH_CHECK_SYMBOL = 'XLK';
const SECTOR_ETF_MAP = {
    'Technology': 'XLK',
    'Financials': 'XLF',
    'Energy': 'XLE',
    'Healthcare': 'XLV',
    'Consumer Discretionary': 'XLY',
    'Consumer Staples': 'XLP',
    'Industrials': 'XLI',
    'Materials': 'XLB',
    'Real Estate': 'XLRE',
    'Utilities': 'XLU',
    'Communication Services': 'XLC',
};
export const SECTOR_ETFS = Object.values(SECTOR_ETF_MAP);
export class SectorPerformanceDataSource extends BaseDataSource {
    name = 'Sector Performance';
    kind = 'prices';
    provider = 'finnhub';
    pricesRepo;
    constructor(options) {
        super();
        this.pricesRepo = options.pricesRepo;
    }
    async probe() {
        const bars = this.pricesRepo.listBySymbol(HEALTH_CHECK_SYMBOL, 7);
        if (bars.length === 0) {
            throw new Error(`No cached price bars for ${HEALTH_CHECK_SYMBOL}. Run price backfill first.`);
        }
        return `Found ${bars.length} cached bars for ${HEALTH_CHECK_SYMBOL}`;
    }
    async fetch() {
        const results = [];
        for (const [sector, etfSymbol] of Object.entries(SECTOR_ETF_MAP)) {
            const bars = this.pricesRepo.listBySymbol(etfSymbol, 90);
            if (bars.length === 0) {
                log.warn('no cached price data for sector etf', { etfSymbol, sector });
                continue;
            }
            const priceData = bars.map((b) => ({
                date: new Date(b.barDate).getTime(),
                close: b.closeCents / 100,
            }));
            results.push({
                sector,
                etfSymbol,
                return1d: this.calculateReturn(priceData, 1),
                return1w: this.calculateReturn(priceData, 7),
                return1m: this.calculateReturn(priceData, 30),
                return3m: this.calculateReturn(priceData, 90),
                avgPE: null,
                avgVolatility: null,
            });
        }
        log.info('sector performance fetched', { sectorCount: results.length });
        return results;
    }
    calculateReturn(priceData, days) {
        if (priceData.length < 2)
            return 0;
        const cutoffTime = Date.now() - days * 86400 * 1000;
        // Find the price closest to (but before) the cutoff
        let startPrice = priceData[0].close;
        for (const p of priceData) {
            if (p.date <= cutoffTime) {
                startPrice = p.close;
            }
        }
        const endPrice = priceData[priceData.length - 1].close;
        const ret = ((endPrice - startPrice) / startPrice) * 100;
        return Math.round(ret * 100) / 100;
    }
}
// Backwards compatibility alias
export { SectorPerformanceDataSource as YahooSectorPerformance };
//# sourceMappingURL=sectorPerformance.js.map