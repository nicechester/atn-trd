import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { YahooSectorPerformance } from '../datasources/sectors/index.js';
import type { FundamentalsDataSource } from '../datasources/fundamentals/index.js';
import type { OptionsDataSource } from '../datasources/options/index.js';
import type { RunCache } from '../datasources/cache.js';

export interface ScreenerToolsDeps {
  sectorSource: YahooSectorPerformance;
  fundamentalsSource: FundamentalsDataSource;
  optionsSource: OptionsDataSource;
  cache: RunCache;
}

export function createScreenerTools(deps: ScreenerToolsDeps): DynamicStructuredTool[] {
  return [
    makeGetSectorPerformance(deps),
    makeGetEarningsCalendar(deps),
    makeGetUnusualOptionsActivity(deps),
  ];
}

function makeGetSectorPerformance(deps: ScreenerToolsDeps) {
  const schema = z.object({
    sector: z.string().describe('Sector name (e.g., Technology, Healthcare, Financials)'),
  });

  return new DynamicStructuredTool({
    name: 'get_sector_performance',
    description: 'Fetch sector performance data and momentum indicators',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        const { sector } = input;
        const cacheKey = 'sector_performance_all';

        const allSectors = await deps.cache.getOrFetch(cacheKey, 300_000, async () => {
          return await deps.sectorSource.fetch();
        });

        // Find the matching sector
        const sectorData = allSectors.find((s: any) => s.sector.toLowerCase() === sector.toLowerCase());

        if (!sectorData) {
          return JSON.stringify({
            error: `Sector "${sector}" not found`,
          });
        }

        return JSON.stringify(sectorData);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

function makeGetEarningsCalendar(deps: ScreenerToolsDeps) {
  const schema = z.object({
    symbol: z.string().describe('Stock ticker symbol'),
  });

  return new DynamicStructuredTool({
    name: 'get_earnings_calendar',
    description: 'Fetch earnings dates and estimates for a symbol',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        const { symbol } = input;
        const cacheKey = `earnings:${symbol}`;

        const result = await deps.cache.getOrFetch(cacheKey, 60_000, async () => {
          return await deps.fundamentalsSource.fetch({ symbol });
        });

        const { earnings } = result.data;
        return JSON.stringify({
          symbol,
          nextEarningsDate: earnings.nextEarningsDate,
          earningsDates: earnings.earningsDates,
          estimateAverage: earnings.estimateAverage,
          estimateLow: earnings.estimateLow,
          estimateHigh: earnings.estimateHigh,
          recentQuarters: earnings.recentQuarters,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

function makeGetUnusualOptionsActivity(deps: ScreenerToolsDeps) {
  const schema = z.object({
    symbol: z.string().describe('Stock ticker symbol'),
  });

  return new DynamicStructuredTool({
    name: 'get_unusual_options_activity',
    description:
      'Fetch unusual options activity, IV skew, and put/call ratios for a symbol',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        const { symbol } = input;
        const cacheKey = `options:${symbol}`;

        const result = await deps.cache.getOrFetch(cacheKey, 60_000, async () => {
          return await deps.optionsSource.fetch({ symbol });
        });

        return JSON.stringify({
          symbol,
          underlyingPrice: result.data.underlyingPrice,
          expiration: result.data.expiration,
          expirationDates: result.data.expirationDates,
          calls: result.data.calls?.slice(0, 3), // Top 3 calls
          puts: result.data.puts?.slice(0, 3), // Top 3 puts
          metrics: result.data.metrics,
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}
