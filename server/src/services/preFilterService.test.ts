import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPreFilter, type PreFilterConfig } from './preFilterService.js';
import type { AgentToolsDeps } from '../agent/tools.js';
import type { FundamentalsPayload } from '../datasources/fundamentals/yahooFundamentals.js';
import type { DataSourceResult } from '../datasources/types.js';

// Mock fundamentals source
function createMockFundamentalsSource(
  testCases: Record<string, FundamentalsPayload | Error>
) {
  return {
    fetch: async (query: { symbol: string }): Promise<DataSourceResult<FundamentalsPayload>> => {
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
    const fundamentals: Record<string, FundamentalsPayload> = {
      'CHEAP': {
        symbol: 'CHEAP',
        name: 'Cheap Stock',
        price: 0.5,
        marketCap: 1e9,
        averageVolume: 2e6,
        sector: 'Tech',
        industry: 'Software',
      } as FundamentalsPayload,
      'PRICEY': {
        symbol: 'PRICEY',
        name: 'Pricey Stock',
        price: 15000,
        marketCap: 1e12,
        averageVolume: 2e6,
        sector: 'Tech',
        industry: 'Software',
      } as FundamentalsPayload,
      'GOOD': {
        symbol: 'GOOD',
        name: 'Good Stock',
        price: 50,
        marketCap: 1e10,
        averageVolume: 2e6,
        sector: 'Tech',
        industry: 'Software',
      } as FundamentalsPayload,
    };

    const config: PreFilterConfig = {
      universe: 'custom',
      customSymbols: ['CHEAP', 'PRICEY', 'GOOD'],
      maxCandidates: 10,
      minPrice: 1,
      maxPrice: 10000,
      minVolume: 1e6,
      minMarketCap: 0,
    };

    const deps = {
      fundamentalsSource: createMockFundamentalsSource(fundamentals),
    } as unknown as AgentToolsDeps;

    const result = await runPreFilter(config, deps);

    assert.deepStrictEqual(
      result.candidates.map((c) => c.symbol).sort(),
      ['GOOD']
    );
    assert.strictEqual(result.rejected.length, 2);
    assert.ok(result.rejected.some((r) => r.symbol === 'CHEAP'));
    assert.ok(result.rejected.some((r) => r.symbol === 'PRICEY'));
  });

  it('filters by volume', async () => {
    const fundamentals: Record<string, FundamentalsPayload> = {
      'LOWVOL': {
        symbol: 'LOWVOL',
        name: 'Low Volume Stock',
        price: 50,
        marketCap: 1e10,
        averageVolume: 100000, // Below 1M threshold
        sector: 'Tech',
        industry: 'Software',
      } as FundamentalsPayload,
      'HIGHVOL': {
        symbol: 'HIGHVOL',
        name: 'High Volume Stock',
        price: 50,
        marketCap: 1e10,
        averageVolume: 5e6,
        sector: 'Tech',
        industry: 'Software',
      } as FundamentalsPayload,
    };

    const config: PreFilterConfig = {
      universe: 'custom',
      customSymbols: ['LOWVOL', 'HIGHVOL'],
      maxCandidates: 10,
      minPrice: 1,
      maxPrice: 10000,
      minVolume: 1e6,
      minMarketCap: 0,
    };

    const deps = {
      fundamentalsSource: createMockFundamentalsSource(fundamentals),
    } as unknown as AgentToolsDeps;

    const result = await runPreFilter(config, deps);

    assert.deepStrictEqual(result.candidates.map((c) => c.symbol), ['HIGHVOL']);
    assert.strictEqual(result.rejected.length, 1);
  });

  it('handles fetch failures gracefully', async () => {
    const fundamentals: Record<string, FundamentalsPayload | Error> = {
      'GOOD': {
        symbol: 'GOOD',
        name: 'Good Stock',
        price: 50,
        marketCap: 1e10,
        averageVolume: 2e6,
        sector: 'Tech',
        industry: 'Software',
      } as FundamentalsPayload,
      'BAD': new Error('Fundamentals fetch failed'),
    };

    const config: PreFilterConfig = {
      universe: 'custom',
      customSymbols: ['GOOD', 'BAD'],
      maxCandidates: 10,
      minPrice: 1,
      maxPrice: 10000,
      minVolume: 1e6,
      minMarketCap: 0,
    };

    const deps = {
      fundamentalsSource: createMockFundamentalsSource(fundamentals),
    } as unknown as AgentToolsDeps;

    const result = await runPreFilter(config, deps);

    assert.deepStrictEqual(result.candidates.map((c) => c.symbol), ['GOOD']);
    assert.strictEqual(result.rejected.length, 1);
    assert.ok(result.rejected.some((r) => r.symbol === 'BAD'));
  });

  it('respects maxCandidates limit', async () => {
    const fundamentals: Record<string, FundamentalsPayload> = {
      'A': {
        symbol: 'A',
        price: 50,
        marketCap: 3e10, // Highest market cap
        averageVolume: 2e6,
        sector: 'Tech',
        industry: 'Software',
      } as FundamentalsPayload,
      'B': {
        symbol: 'B',
        price: 50,
        marketCap: 2e10,
        averageVolume: 2e6,
        sector: 'Tech',
        industry: 'Software',
      } as FundamentalsPayload,
      'C': {
        symbol: 'C',
        price: 50,
        marketCap: 1e10, // Lowest market cap
        averageVolume: 2e6,
        sector: 'Tech',
        industry: 'Software',
      } as FundamentalsPayload,
    };

    const config: PreFilterConfig = {
      universe: 'custom',
      customSymbols: ['A', 'B', 'C'],
      maxCandidates: 2, // Should only keep top 2 by market cap
      minPrice: 1,
      maxPrice: 10000,
      minVolume: 1e6,
      minMarketCap: 0,
    };

    const deps = {
      fundamentalsSource: createMockFundamentalsSource(fundamentals),
    } as unknown as AgentToolsDeps;

    const result = await runPreFilter(config, deps);

    assert.strictEqual(result.candidates.length, 2);
    assert.deepStrictEqual(
      result.candidates.map((c) => c.symbol),
      ['A', 'B'] // Sorted by market cap descending
    );
  });
});
