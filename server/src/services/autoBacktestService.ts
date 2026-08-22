import type Database from 'better-sqlite3';
import { BacktestRepo } from '../repos/backtestRepo.js';
import { WatchlistRepo } from '../repos/watchlistRepo.js';
import { getSettings } from '../config/settingsService.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'auto-backtest' });

// Track in-flight auto-backtests to avoid duplicates
const runningBacktests = new Set<string>();

// Debounce timer for batch additions
let debounceTimer: NodeJS.Timeout | null = null;
let pendingDb: Database.Database | null = null;
const DEBOUNCE_MS = 2000; // Wait 2 seconds for batch additions to complete

/**
 * Queue an auto-backtest for the current watchlist if enabled.
 * Called when watchlist changes (add/remove/toggle).
 * Debounced to handle batch additions (comma-separated symbols).
 */
export function queueWatchlistBacktest(db: Database.Database): void {
  // Debounce: wait for batch additions to complete
  pendingDb = db;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (pendingDb) {
      runBacktestNow(pendingDb);
      pendingDb = null;
    }
  }, DEBOUNCE_MS);
}

function runBacktestNow(db: Database.Database): void {
  const settings = getSettings();
  
  if (!settings.watchlist.autoBacktest) {
    log.debug('auto-backtest disabled, skipping');
    return;
  }

  const watchlistRepo = new WatchlistRepo(db);
  const enabledSymbols = watchlistRepo.list()
    .filter(w => w.enabled)
    .map(w => w.symbol);

  if (enabledSymbols.length === 0) {
    log.debug('no enabled symbols, skipping auto-backtest');
    return;
  }

  // Create a fingerprint to avoid duplicate runs
  const fingerprint = enabledSymbols.sort().join(',');
  if (runningBacktests.has(fingerprint)) {
    log.debug('auto-backtest already running for this watchlist');
    return;
  }

  // Run everything else in background
  setImmediate(async () => {
    try {
      const months = settings.watchlist.autoBacktestMonths || 12;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);
      const formatDate = (d: Date) => d.toISOString().slice(0, 10);

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

      const { runBacktestInBackground } = await import('../routes/backtest.js');
      
      await runBacktestInBackground(db, backtestId, {
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        symbols: allSymbols,
      });
    } catch (err) {
      log.error('auto-backtest failed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      runningBacktests.delete(fingerprint);
    }
  });
}
