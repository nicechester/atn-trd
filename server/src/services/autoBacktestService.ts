import type Database from 'better-sqlite3';
import { BacktestRepo } from '../repos/backtestRepo.js';
import { WatchlistRepo } from '../repos/watchlistRepo.js';
import { getSettings } from '../config/settingsService.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'auto-backtest' });

// Track in-flight auto-backtests to avoid duplicates
const runningBacktests = new Set<string>();

/**
 * Queue an auto-backtest for the current watchlist if enabled.
 * Called when watchlist changes (add/remove/toggle).
 */
export async function queueWatchlistBacktest(db: Database.Database): Promise<string | null> {
  const settings = getSettings();
  
  if (!settings.watchlist.autoBacktest) {
    log.debug('auto-backtest disabled, skipping');
    return null;
  }

  const watchlistRepo = new WatchlistRepo(db);
  const enabledSymbols = watchlistRepo.list()
    .filter(w => w.enabled)
    .map(w => w.symbol);

  if (enabledSymbols.length === 0) {
    log.debug('no enabled symbols, skipping auto-backtest');
    return null;
  }

  // Create a fingerprint to avoid duplicate runs
  const fingerprint = enabledSymbols.sort().join(',');
  if (runningBacktests.has(fingerprint)) {
    log.debug('auto-backtest already running for this watchlist');
    return null;
  }

  // Calculate date range
  const months = settings.watchlist.autoBacktestMonths || 12;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  const formatDate = (d: Date) => d.toISOString().slice(0, 10);

  // Ensure SPY for benchmark
  const allSymbols = enabledSymbols.includes('SPY') 
    ? enabledSymbols 
    : [...enabledSymbols, 'SPY'];

  const backtestRepo = new BacktestRepo(db);
  const backtestId = backtestRepo.createRun({
    name: `Auto: Watchlist (${allSymbols.length - 1} symbols)`,
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    symbols: allSymbols,
    settingsSnapshot: JSON.stringify({ autoBacktest: true }),
  });

  log.info('queued auto-backtest', { 
    backtestId, 
    symbols: allSymbols.length, 
    months,
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  });

  runningBacktests.add(fingerprint);

  // Import dynamically to avoid circular deps
  const { runBacktestInBackground } = await import('../routes/backtest.js');
  
  runBacktestInBackground(db, backtestId, {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    symbols: allSymbols,
  }).finally(() => {
    runningBacktests.delete(fingerprint);
  });

  return backtestId;
}
