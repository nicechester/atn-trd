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
import { dataSourceRegistry } from '../../datasources/registry.js';
import type { NewsDataSource } from '../../datasources/news/index.js';
import { getSettings } from '../../config/settingsService.js';

const log = logger.child({ component: 'signal-collection-job' });

export async function runSignalCollectionJob(db: Database.Database): Promise<void> {
  const now = new Date();

  if (!isTradingDay(now)) {
    log.info('not a trading day, skipping signal collection');
    return;
  }

  const settings = getSettings();
  if (!settings.signals.enabled) {
    log.info('signal collection disabled in settings');
    return;
  }

  try {
    const signalSnapshotsRepo = new SignalSnapshotsRepo(db);
    const pricesRepo = new PricesRepo(db);
    const watchlistRepo = new WatchlistRepo(db);
    const newsSource = dataSourceRegistry.get('news') as unknown as NewsDataSource;

    const results = await runSignalCollection({
      signalSnapshotsRepo,
      pricesRepo,
      watchlistRepo,
      newsSource,
      getSettings,
    });

    const okCount = results.filter(r => r.status === 'ok').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    log.info('signal collection job complete', { ok: okCount, errors: errorCount });
  } catch (err) {
    log.error('signal collection job failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
