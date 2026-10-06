/**
 * Historical price provider for backtesting.
 * Wraps the PricesRepo to provide historical prices for the MockBroker.
 */
export function createHistoricalPriceProvider(pricesRepo) {
    return {
        async getPrice(symbol, date) {
            const bar = pricesRepo.get(symbol, date);
            if (!bar)
                return null;
            return {
                openCents: bar.openCents,
                closeCents: bar.closeCents,
            };
        },
    };
}
/**
 * Get SPY benchmark price for a given date.
 */
export function createBenchmarkPriceProvider(pricesRepo) {
    return async (date) => {
        const bar = pricesRepo.get('SPY', date);
        return bar?.closeCents ?? null;
    };
}
//# sourceMappingURL=priceProvider.js.map