/**
 * Watchlist Curation Service
 * 
 * Runs the screener to pick symbols from dynamic universe,
 * then populates the watchlist table with categories.
 * 
 * This is triggered manually (not scheduled) when user wants fresh picks.
 */

import type Database from 'better-sqlite3';
import { getLlmLimits } from '@atn-trd/shared';
import { logger } from '../lib/logger.js';
import { getSettings } from '../config/settingsService.js';
import { WatchlistRepo } from '../repos/watchlistRepo.js';
import { SymbolCategoriesRepo, type SymbolCategory } from '../repos/symbolCategoriesRepo.js';
import { ScreenerSelectionsRepo } from '../repos/screenerSelectionsRepo.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { ArtifactsRepo } from '../repos/artifactsRepo.js';
import { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import { DecisionsRepo } from '../repos/decisionsRepo.js';
import { RunsRepo } from '../repos/runsRepo.js';
import { runScreener } from './screenerOrchestrationService.js';
import { PortfolioServiceImpl } from './portfolioService.js';
import { PriceService } from './priceService.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { dataSourceRegistry } from '../datasources/registry.js';
import { YahooSectorPerformance } from '../datasources/sectors/index.js';
import { RunCache } from '../datasources/cache.js';
import type { FundamentalsDataSource } from '../datasources/fundamentals/index.js';
import type { OptionsDataSource } from '../datasources/options/index.js';
import type { NewsDataSource } from '../datasources/news/index.js';
import type { MacroDataSource } from '../datasources/macro/index.js';

const log = logger.child({ component: 'watchlist-curation' });

export interface WatchlistCurationSummary {
  symbolsAdded: string[];
  symbolsUpdated: string[];
  totalInWatchlist: number;
  screenerSelections: number;
}

/**
 * Classify symbol into category based on fundamentals.
 */
function classifySymbol(dividendYield: number | null, dividendGrowthRate: number | null): SymbolCategory {
  const yld = dividendYield ?? 0;
  const growth = dividendGrowthRate ?? 0;
  
  if (yld > 0.04) return 'INCOME_BOOSTER';       // >4% yield
  if (yld > 0.01 && growth > 0.05) return 'DIVIDEND_GROWTH';  // 1-4% yield + growing
  return 'GROWTH_CORE';                          // Low/no dividend
}

/**
 * Run screener and populate watchlist table with results.
 */
export async function runWatchlistCuration(db: Database.Database): Promise<WatchlistCurationSummary> {
  const settings = getSettings();
  const runsRepo = new RunsRepo(db);
  
  const summary: WatchlistCurationSummary = {
    symbolsAdded: [],
    symbolsUpdated: [],
    totalInWatchlist: 0,
    screenerSelections: 0,
  };

  // Create a run record for tracking
  const runId = runsRepo.create({
    trigger: 'watchlist_curation',
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    model: settings.llm.model,
    settingsSnapshot: JSON.stringify(settings),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null,
  });

  try {
    // Ensure dynamic mode is enabled
    if (settings.watchlist.mode !== 'dynamic') {
      runsRepo.setSkipped(runId, 'watchlist not in dynamic mode');
      return summary;
    }

    // Set up dependencies for screener
    const pricesRepo = new PricesRepo(db);
    const screenerSelectionsRepo = new ScreenerSelectionsRepo(db);
    const messagesRepo = new AgentMessagesRepo(db);
    const artifactsRepo = new ArtifactsRepo(db);
    const decisionsRepo = new DecisionsRepo(db);
    const positionsRepo = new PositionsRepo(db);
    const portfolioRepo = new PortfolioRepo(db);
    const watchlistRepo = new WatchlistRepo(db);
    const symbolCategoriesRepo = new SymbolCategoriesRepo(db);

    const runCache = new RunCache();
    const sectorSource = new YahooSectorPerformance({ pricesRepo });
    const priceService = new PriceService(pricesRepo);
    const portfolioService = new PortfolioServiceImpl(db, priceService, positionsRepo, portfolioRepo);

    const toolsDeps = {
      newsSource: dataSourceRegistry.get('news') as unknown as NewsDataSource,
      fundamentalsSource: dataSourceRegistry.get('fundamentals') as unknown as FundamentalsDataSource,
      macroSource: dataSourceRegistry.get('macro') as unknown as MacroDataSource,
      optionsSource: dataSourceRegistry.get('options') as unknown as OptionsDataSource,
      sectorSource,
      pricesRepo,
      portfolioService,
      decisionsRepo,
      cache: runCache,
      llmLimits: getLlmLimits(settings.llm.localLlmMode),
    };

    const screenerDeps = {
      screenerSelectionsRepo,
      screenerAgentDeps: {
        toolsDeps: {
          sectorSource,
          fundamentalsSource: dataSourceRegistry.get('fundamentals') as unknown as FundamentalsDataSource,
          optionsSource: dataSourceRegistry.get('options') as unknown as OptionsDataSource,
          cache: runCache,
        },
        messagesRepo,
        artifactsRepo,
      },
      toolsDeps,
    };

    // Run the screener
    log.info('running screener for watchlist curation');
    const result = await runScreener(runId, settings, screenerDeps);

    if (!result || result.selections.length === 0) {
      runsRepo.setSkipped(runId, 'screener returned no selections');
      return summary;
    }

    summary.screenerSelections = result.selections.length;
    log.info('screener complete', { selections: result.selections.length });

    // Add selections to watchlist and categories
    const now = Date.now();
    for (const selection of result.selections) {
      const candidate = result.candidates.find(c => c.symbol === selection.symbol);
      const fundamentals = candidate?.fundamentals;

      // Determine category based on dividend yield only (growth data not available)
      const dividendYield = fundamentals?.dividendYield ?? null;
      const category = classifySymbol(dividendYield, null);

      // Check if already in watchlist
      const existing = watchlistRepo.get(selection.symbol);
      
      if (!existing) {
        // Add to watchlist
        watchlistRepo.addSymbol(selection.symbol, selection.rationale);
        summary.symbolsAdded.push(selection.symbol);
      } else {
        summary.symbolsUpdated.push(selection.symbol);
      }

      // Upsert category data
      symbolCategoriesRepo.upsert({
        symbol: selection.symbol,
        category,
        yieldPercent: dividendYield ? dividendYield * 100 : null,
        dividendGrowthPercent: null, // Not available from fundamentals
        estCagrPercent: null,
        lastScreenedAt: now,
      });
    }

    summary.totalInWatchlist = watchlistRepo.list().length;

    runsRepo.updateStatus(runId, 'succeeded');
    runsRepo.updateSummary(runId, JSON.stringify(summary));

    log.info('watchlist curation complete', { ...summary });
    return summary;
  } catch (err) {
    runsRepo.updateStatus(runId, 'failed', err instanceof Error ? err.message : String(err));
    log.error('watchlist curation failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
