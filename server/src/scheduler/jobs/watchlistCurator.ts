/**
 * Scheduled Watchlist Curator Job
 * 
 * Runs the screener to refresh watchlist picks on a configurable schedule.
 * Only runs when watchlist.mode === 'dynamic' and curatorSchedule !== 'manual'.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../lib/logger.js';
import { getSettings } from '../../config/settingsService.js';
import { runWatchlistCuration } from '../../services/watchlistCurationService.js';
import { isTradingDay } from '../marketCalendar.js';

const log = logger.child({ component: 'watchlist-curator-job' });

export async function runWatchlistCuratorJob(db: Database.Database): Promise<void> {
  // Skip on non-trading days
  if (!isTradingDay(new Date())) {
    log.info('watchlist curator skipped (not a trading day)');
    return;
  }

  const settings = getSettings();

  // Skip if not in dynamic mode
  if (settings.watchlist.mode !== 'dynamic') {
    log.debug('watchlist curator skipped (not in dynamic mode)');
    return;
  }

  // Skip if no cron set
  if (!settings.watchlist.curatorCron) {
    log.debug('watchlist curator skipped (no cron set)');
    return;
  }

  try {
    log.info('starting scheduled watchlist curation');
    const summary = await runWatchlistCuration(db);
    log.info('scheduled watchlist curation complete', { ...summary });
  } catch (err) {
    log.error('scheduled watchlist curation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
