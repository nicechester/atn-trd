/**
 * Daily signal collection job.
 * Runs on trading days to collect market signals for watchlist symbols.
 * Does NOT make trading decisions — just collects data.
 */

import type Database from 'better-sqlite3';
import { isTradingDay } from '../marketCalendar.js';
import { logger } from '../../lib/logger.js';
import { runSignalCollection } from '../../services/signalCollectionService.js';
import { SignalSnapshotsRepo } from '../../repos/signalSnapshotsRepo.js';
import { PricesRepo } from '../../repos/pricesRepo.js';
import { WatchlistRepo } from '../../repos/watchlistRepo.js';
import { PositionsRepo } from '../../repos/positionsRepo.js';
import { RunsRepo, type RunTrigger } from '../../repos/runsRepo.js';
import { dataSourceRegistry } from '../../datasources/registry.js';
import type { NewsDataSource } from '../../datasources/news/index.js';
import { getSettings } from '../../config/settingsService.js';

const log = logger.child({ component: 'signal-collection-job' });

export interface SignalCollectionSummary {
  symbolsUpdated: number;
  errors: number;
  symbols: string[];
  tokensUsed: number;
}

export async function runSignalCollectionJob(
  db: Database.Database,
  trigger: RunTrigger = 'signal_collection'
): Promise<SignalCollectionSummary> {
  const now = new Date();
  const settings = getSettings();
  const runsRepo = new RunsRepo(db);

  const summary: SignalCollectionSummary = {
    symbolsUpdated: 0,
    errors: 0,
    symbols: [],
    tokensUsed: 0,
  };

  // Create run record
  const runId = runsRepo.create({
    trigger,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    model: null,
    settingsSnapshot: JSON.stringify(settings),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null,
  });

  try {
    if (!isTradingDay(now) && trigger !== 'manual') {
      runsRepo.setSkipped(runId, 'not a trading day');
      return summary;
    }

    if (!settings.signals.enabled) {
      runsRepo.setSkipped(runId, 'signal collection disabled');
      return summary;
    }

    const signalSnapshotsRepo = new SignalSnapshotsRepo(db);
    const pricesRepo = new PricesRepo(db);
    const watchlistRepo = new WatchlistRepo(db);
    const positionsRepo = new PositionsRepo(db);
    const newsSource = dataSourceRegistry.get('news') as unknown as NewsDataSource;

    // Get position symbols to include in signal collection
    const positionSymbols = positionsRepo.list().map(p => p.symbol);

    const results = await runSignalCollection({
      signalSnapshotsRepo,
      pricesRepo,
      watchlistRepo,
      positionSymbols,
      newsSource,
      getSettings,
    });

    summary.symbolsUpdated = results.filter(r => r.status === 'ok').length;
    summary.errors = results.filter(r => r.status === 'error').length;
    summary.symbols = results.filter(r => r.status === 'ok').map(r => r.symbol);
    summary.tokensUsed = results.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);

    runsRepo.updateStatus(runId, 'succeeded');
    runsRepo.updateSummary(runId, JSON.stringify(summary));

    // Track token usage if LLM was used
    if (summary.tokensUsed > 0) {
      runsRepo.updateTokenUsage(runId, JSON.stringify({
        total_tokens: summary.tokensUsed,
        prompt_tokens: Math.round(summary.tokensUsed * 0.8),
        completion_tokens: Math.round(summary.tokensUsed * 0.2),
      }));
    }

    log.info('signal collection job complete', { ok: summary.symbolsUpdated, errors: summary.errors });
    return summary;
  } catch (err) {
    runsRepo.updateStatus(runId, 'failed', err instanceof Error ? err.message : String(err));
    log.error('signal collection job failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
