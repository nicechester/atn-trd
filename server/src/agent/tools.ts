import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NewsDataSource } from '../datasources/news/index.js';
import type { FundamentalsDataSource } from '../datasources/fundamentals/index.js';
import type { MacroDataSource } from '../datasources/macro/index.js';
import type { OptionsDataSource } from '../datasources/options/index.js';
import type { YahooSectorPerformance } from '../datasources/sectors/index.js';
import type { PricesRepo } from '../repos/pricesRepo.js';
import type { PriceBarRow } from '../repos/pricesRepo.js';
import type { PortfolioService, PositionDetail } from '../services/portfolioService.js';
import type { DecisionsRepo } from '../repos/decisionsRepo.js';
import type { SemanticMemoryService } from '../services/semanticMemoryService.js';
import { toIsoDate } from '../datasources/news/types.js';
import type { RunCache } from '../datasources/cache.js';
import { getVolatilityMetrics } from '../services/volatilityService.js';

export interface AgentToolsDeps {
  newsSource: NewsDataSource;
  fundamentalsSource: FundamentalsDataSource;
  macroSource: MacroDataSource;
  optionsSource: OptionsDataSource;
  sectorSource: YahooSectorPerformance;
  pricesRepo: PricesRepo;
  portfolioService: PortfolioService;
  decisionsRepo: DecisionsRepo;
  cache: RunCache;
  semanticMemory?: SemanticMemoryService;
  llmLimits?: {
    maxNewsArticles: number;
    maxNewsDays: number;
    truncateNewsSummary: number;
  };
}

function makeGetNews(deps: AgentToolsDeps) {
  const maxArticles = deps.llmLimits?.maxNewsArticles ?? 50;
  const maxDays = deps.llmLimits?.maxNewsDays ?? 90;

  const schema = z.object({
    symbol: z.string().describe('Stock ticker symbol'),
    days: z.number().int().optional().describe(`Days back to search (1–${maxDays}, default 7)`),
    limit: z.number().int().optional().describe(`Max articles to return (1–${maxArticles}, default 20)`),
  });

  return new DynamicStructuredTool({
    name: 'get_news',
    description: 'Fetch recent news articles for a given symbol',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        const symbol = input.symbol;
        const days = input.days ?? 7;
        const limit = input.limit ?? Math.min(20, maxArticles);

        // Clamp to configured limits
        const clampedDays = Math.max(1, Math.min(maxDays, days));
        const clampedLimit = Math.max(1, Math.min(maxArticles, limit));

        // Cache by symbol only (ignore days) - news doesn't change that fast
        const cacheKey = `news:${symbol}`;

        const result = await deps.cache.getOrFetch(cacheKey, 300_000, async () => {
          const now = Date.now();
          const fromMs = now - clampedDays * 86_400_000;
          const from = toIsoDate(fromMs);
          const to = toIsoDate(now);

          return await deps.newsSource.fetch({
            symbol,
            from,
            to,
            limit: clampedLimit,
          });
        });

        // Truncate articles for LLM context - keep headline + truncated summary
        const truncateLen = deps.llmLimits?.truncateNewsSummary ?? 0;
        const truncated = {
          ...result.data,
          articles: result.data.articles.map(a => ({
            headline: a.headline,
            summary: truncateLen > 0 && a.summary ? a.summary.slice(0, truncateLen) : a.summary,
            source: a.source,
            publishedAt: a.publishedAt,
          })),
        };

        return JSON.stringify(truncated);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

function makeGetFundamentals(deps: AgentToolsDeps) {
  const schema = z.object({
    symbol: z.string().describe('Stock ticker symbol'),
  });

  return new DynamicStructuredTool({
    name: 'get_fundamentals',
    description: 'Fetch fundamental company data including valuations, earnings, and ratios',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        const symbol = input.symbol;
        const cacheKey = `fundamentals:${symbol}`;

        const result = await deps.cache.getOrFetch(cacheKey, 60_000, async () => {
          return await deps.fundamentalsSource.fetch({ symbol });
        });

        return JSON.stringify(result.data);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

function makeGetMacro(deps: AgentToolsDeps) {
  const schema = z
    .object({
      seriesIds: z
        .array(z.string())
        .optional()
        .describe(
          'FRED series IDs to fetch. Omit for defaults: DGS10, DGS2, T10Y2Y, CPIAUCSL, UNRATE, FEDFUNDS, VIXCLS, UMCSENT'
        ),
    })
    .passthrough();

  return new DynamicStructuredTool({
    name: 'get_macro',
    description: 'Fetch macroeconomic indicators from FRED',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        const seriesIds = input.seriesIds ?? undefined;
        const seriesKey = seriesIds ? seriesIds.sort().join(',') : 'default';
        const cacheKey = `macro:${seriesKey}`;

        const result = await deps.cache.getOrFetch(cacheKey, 300_000, async () => {
          return await deps.macroSource.fetch({ seriesIds });
        });

        return JSON.stringify(result.data);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

function makeGetOptionsSnapshot(deps: AgentToolsDeps) {
  const schema = z.object({
    symbol: z.string().describe('Stock ticker symbol'),
  });

  return new DynamicStructuredTool({
    name: 'get_options_snapshot',
    description: 'Fetch current options chain snapshot for a given symbol',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        const symbol = input.symbol;
        const cacheKey = `options:${symbol}`;

        const result = await deps.cache.getOrFetch(cacheKey, 300_000, async () => {
          return await deps.optionsSource.fetch({ symbol });
        });

        return JSON.stringify(result.data);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

function makeGetPriceHistory(deps: AgentToolsDeps) {
  const schema = z.object({
    symbol: z.string().describe('Stock ticker symbol'),
    days: z.number().int().optional().describe('Days of history to return (1–504, default 90)'),
  });

  return new DynamicStructuredTool({
    name: 'get_price_history',
    description: 'Fetch cached historical price bars for a given symbol',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        const symbol = input.symbol;
        const days = input.days ?? 90;

        // Clamp days to 1–504 (roughly 2 years of trading days)
        const clampedDays = Math.max(1, Math.min(504, days));

        // Get price bars from the repository
        const bars = deps.pricesRepo.listBySymbol(symbol, clampedDays);

        // Map cents to dollars
        const mapped = bars.map((bar: PriceBarRow) => ({
          barDate: bar.barDate,
          open: bar.openCents / 100,
          high: bar.highCents / 100,
          low: bar.lowCents / 100,
          close: bar.closeCents / 100,
          adjClose: bar.adjCloseCents / 100,
          volume: bar.volume,
        }));

        return JSON.stringify({ symbol, bars: mapped });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

function makeGetPortfolio(deps: AgentToolsDeps) {
  const schema = z.object({}).passthrough();

  return new DynamicStructuredTool({
    name: 'get_portfolio',
    description: 'Get the current portfolio state including positions, NAV, and P&L',
    schema,
    func: async (_input: z.infer<typeof schema>) => {
      try {
        const portfolio = await deps.portfolioService.getPortfolio();

        // Map all *Cents fields to USD (divide by 100)
        const mapped = {
          asOfDate: portfolio.asOfDate,
          cash: portfolio.cashCents / 100,
          positionsValue: portfolio.positionsValueCents / 100,
          totalValue: portfolio.totalValueCents / 100,
          totalUnrealizedPnl: portfolio.totalUnrealizedPnlCents / 100,
          totalRealizedPnl: portfolio.totalRealizedPnlCents / 100,
          totalPnl: portfolio.totalPnlCents / 100,
          totalReturnPercent: portfolio.totalReturnPercent,
          positions: portfolio.positions.map((detail: PositionDetail) => ({
            symbol: detail.symbol,
            qty: detail.qty,
            avgCost: detail.avgCostCents / 100,
            currentPrice: detail.currentPriceCents / 100,
            costBasis: detail.costBasisCents / 100,
            marketValue: detail.marketValueCents / 100,
            weightPercent: detail.weightPercent,
            unrealizedPnl: detail.unrealizedPnlCents / 100,
            realizedPnl: detail.realizedPnlCents / 100,
          })),
        };

        return JSON.stringify(mapped);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

function makeGetPriorDecisions(deps: AgentToolsDeps) {
  const schema = z.object({
    symbol: z.string().describe('Stock ticker symbol'),
    limit: z.number().int().optional().describe('Max decisions to return (1–20, default 5)'),
  });

  return new DynamicStructuredTool({
    name: 'get_prior_decisions',
    description: 'Fetch prior trading decisions for a given symbol',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        const symbol = input.symbol;
        const limit = input.limit ?? 5;

        // Clamp limit to 1–20
        const clampedLimit = Math.max(1, Math.min(20, limit));

        const rows = deps.decisionsRepo.listBySymbol(symbol, clampedLimit);
        return JSON.stringify(rows);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

function makeGetSectorPerformance(deps: AgentToolsDeps) {
  const schema = z.object({
    limit: z.number().int().optional().describe('Max sectors to return (default all)'),
  });

  return new DynamicStructuredTool({
    name: 'get_sector_performance',
    description: 'Fetch sector performance metrics (returns, PE, volatility) for sector rotation signals',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        // Cache sector data for 5 minutes - doesn't change frequently
        const cacheKey = 'sectors:all';
        const sectors = await deps.cache.getOrFetch(cacheKey, 300_000, async () => {
          return await deps.sectorSource.fetch();
        });
        const limit = input.limit ?? sectors.length;
        return JSON.stringify(sectors.slice(0, limit));
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

function makeGetSimilarSituations(deps: AgentToolsDeps) {
  const schema = z.object({
    symbol: z.string().describe('Stock ticker symbol'),
    description: z.string().describe('Description of the current situation to find similar historical cases'),
    limit: z.number().int().optional().describe('Max results to return (1–10, default 5)'),
  });

  return new DynamicStructuredTool({
    name: 'get_similar_situations',
    description: 'Find similar historical situations for a symbol based on semantic similarity. Use this to learn from past assessments and research.',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        if (!deps.semanticMemory) {
          return JSON.stringify({ error: 'Semantic memory not available' });
        }

        const symbol = input.symbol;
        const description = input.description;
        const limit = Math.max(1, Math.min(10, input.limit ?? 5));

        const results = await deps.semanticMemory.getSimilarSituations({
          symbol,
          description,
          limit,
        });

        return JSON.stringify(results);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

function makeGetVolatility(deps: AgentToolsDeps) {
  const schema = z.object({
    symbol: z.string().describe('Stock ticker symbol'),
  });

  return new DynamicStructuredTool({
    name: 'get_volatility',
    description: 'Fetch volatility metrics including historical volatility (20d, 60d), beta, and implied volatility',
    schema,
    func: async (input: z.infer<typeof schema>) => {
      try {
        const symbol = input.symbol;
        const cacheKey = `volatility:${symbol}`;

        const result = await deps.cache.getOrFetch(cacheKey, 300_000, async () => {
          const metrics = await getVolatilityMetrics(symbol);
          return { data: metrics };
        });

        return JSON.stringify(result.data);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });
}

export function createAgentTools(deps: AgentToolsDeps) {
  const tools: DynamicStructuredTool[] = [
    makeGetNews(deps),
    makeGetFundamentals(deps),
    makeGetMacro(deps),
    makeGetOptionsSnapshot(deps),
    makeGetSectorPerformance(deps),
    makeGetPriceHistory(deps),
    makeGetPortfolio(deps),
    makeGetPriorDecisions(deps),
    makeGetVolatility(deps),
  ];

  // Add semantic memory tool if available
  if (deps.semanticMemory) {
    tools.push(makeGetSimilarSituations(deps) as DynamicStructuredTool);
  }

  return tools;
}

/**
 * Prefetch datasources concurrently to warm the cache before agent runs.
 * Failures are silently ignored - agent tools will retry if needed.
 */
export async function prefetchForSymbol(symbol: string, deps: AgentToolsDeps): Promise<void> {
  const maxDays = deps.llmLimits?.maxNewsDays ?? 90;
  const maxArticles = deps.llmLimits?.maxNewsArticles ?? 50;

  const now = Date.now();
  const from = toIsoDate(now - Math.min(7, maxDays) * 86_400_000);
  const to = toIsoDate(now);

  await Promise.allSettled([
    deps.cache.getOrFetch(`news:${symbol}`, 300_000, () =>
      deps.newsSource.fetch({ symbol, from, to, limit: Math.min(20, maxArticles) })
    ),
    deps.cache.getOrFetch(`fundamentals:${symbol}`, 60_000, () =>
      deps.fundamentalsSource.fetch({ symbol })
    ),
    deps.cache.getOrFetch(`options:${symbol}`, 300_000, () =>
      deps.optionsSource.fetch({ symbol })
    ),
    deps.cache.getOrFetch(`volatility:${symbol}`, 300_000, () =>
      getVolatilityMetrics(symbol)
    ),
    deps.cache.getOrFetch('macro:default', 300_000, () =>
      deps.macroSource.fetch({})
    ),
    deps.cache.getOrFetch('sectors:all', 300_000, () =>
      deps.sectorSource.fetch()
    ),
  ]);
}
