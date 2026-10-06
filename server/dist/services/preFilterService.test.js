import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPreFilter } from './preFilterService.js';
// Mock fundamentals source
function createMockFundamentalsSource(testCases) {
    return {
        fetch: async (query) => {
            const result = testCases[query.symbol];
            if (result instanceof Error) {
                throw result;
            }
            return {
                data: result,
                provider: 'yahoo',
                fetchedAt: Date.now(),
                citations: [],
                raw: {},
            };
        },
    };
}
describe('preFilterService', () => {
    it('filters by price range', async () => {
        const fundamentals = {
            'CHEAP': {
                symbol: 'CHEAP',
                name: 'Cheap Stock',
                price: 0.5,
                marketCap: 1e9,
                averageVolume: 2e6,
                sector: 'Tech',
                industry: 'Software',
            },
            'PRICEY': {
                symbol: 'PRICEY',
                name: 'Pricey Stock',
                price: 15000,
                marketCap: 1e12,
                averageVolume: 2e6,
                sector: 'Tech',
                industry: 'Software',
            },
            'GOOD': {
                symbol: 'GOOD',
                name: 'Good Stock',
                price: 50,
                marketCap: 1e10,
                averageVolume: 2e6,
                sector: 'Tech',
                industry: 'Software',
            },
        };
        const config = {
            universes: ['custom'],
            customSymbols: ['CHEAP', 'PRICEY', 'GOOD'],
            maxCandidates: 10,
            minPrice: 1,
            maxPrice: 10000,
            minVolume: 1e6,
            minMarketCap: 0,
        };
        const deps = {
            fundamentalsSource: createMockFundamentalsSource(fundamentals),
        };
        const result = await runPreFilter(config, deps);
        assert.deepStrictEqual(result.candidates.map((c) => c.symbol).sort(), ['GOOD']);
        assert.strictEqual(result.rejected.length, 2);
        assert.ok(result.rejected.some((r) => r.symbol === 'CHEAP'));
        assert.ok(result.rejected.some((r) => r.symbol === 'PRICEY'));
    });
    it('filters by volume', async () => {
        const fundamentals = {
            'LOWVOL': {
                symbol: 'LOWVOL',
                name: 'Low Volume Stock',
                price: 50,
                marketCap: 1e10,
                averageVolume: 100000, // Below 1M threshold
                sector: 'Tech',
                industry: 'Software',
            },
            'HIGHVOL': {
                symbol: 'HIGHVOL',
                name: 'High Volume Stock',
                price: 50,
                marketCap: 1e10,
                averageVolume: 5e6,
                sector: 'Tech',
                industry: 'Software',
            },
        };
        const config = {
            universes: ['custom'],
            customSymbols: ['LOWVOL', 'HIGHVOL'],
            maxCandidates: 10,
            minPrice: 1,
            maxPrice: 10000,
            minVolume: 1e6,
            minMarketCap: 0,
        };
        const deps = {
            fundamentalsSource: createMockFundamentalsSource(fundamentals),
        };
        const result = await runPreFilter(config, deps);
        assert.deepStrictEqual(result.candidates.map((c) => c.symbol), ['HIGHVOL']);
        assert.strictEqual(result.rejected.length, 1);
    });
    it('handles fetch failures gracefully', async () => {
        const fundamentals = {
            'GOOD': {
                symbol: 'GOOD',
                name: 'Good Stock',
                price: 50,
                marketCap: 1e10,
                averageVolume: 2e6,
                sector: 'Tech',
                industry: 'Software',
            },
            'BAD': new Error('Fundamentals fetch failed'),
        };
        const config = {
            universes: ['custom'],
            customSymbols: ['GOOD', 'BAD'],
            maxCandidates: 10,
            minPrice: 1,
            maxPrice: 10000,
            minVolume: 1e6,
            minMarketCap: 0,
        };
        const deps = {
            fundamentalsSource: createMockFundamentalsSource(fundamentals),
        };
        const result = await runPreFilter(config, deps);
        assert.deepStrictEqual(result.candidates.map((c) => c.symbol), ['GOOD']);
        assert.strictEqual(result.rejected.length, 1);
        assert.ok(result.rejected.some((r) => r.symbol === 'BAD'));
    });
    it('respects maxCandidates limit', async () => {
        const fundamentals = {
            'A': {
                symbol: 'A',
                price: 50,
                marketCap: 3e10, // Highest market cap
                averageVolume: 2e6,
                sector: 'Tech',
                industry: 'Software',
            },
            'B': {
                symbol: 'B',
                price: 50,
                marketCap: 2e10,
                averageVolume: 2e6,
                sector: 'Tech',
                industry: 'Software',
            },
            'C': {
                symbol: 'C',
                price: 50,
                marketCap: 1e10, // Lowest market cap
                averageVolume: 2e6,
                sector: 'Tech',
                industry: 'Software',
            },
        };
        const config = {
            universes: ['custom'],
            customSymbols: ['A', 'B', 'C'],
            maxCandidates: 2, // Should only keep top 2 by market cap
            minPrice: 1,
            maxPrice: 10000,
            minVolume: 1e6,
            minMarketCap: 0,
        };
        const deps = {
            fundamentalsSource: createMockFundamentalsSource(fundamentals),
        };
        const result = await runPreFilter(config, deps);
        assert.strictEqual(result.candidates.length, 2);
        assert.deepStrictEqual(result.candidates.map((c) => c.symbol), ['A', 'B'] // Sorted by market cap descending
        );
    });
});
//# sourceMappingURL=preFilterService.test.js.map