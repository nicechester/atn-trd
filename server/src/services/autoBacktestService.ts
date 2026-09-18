import type Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BacktestRepo } from '../repos/backtestRepo.js';
import { WatchlistRepo } from '../repos/watchlistRepo.js';
import { getSettings } from '../config/settingsService.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'auto-backtest' });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

/**
 * Spawn backtest CLI in background.
 */
function spawnBacktestCli(
  backtestId: string,
  config: { startDate: string; endDate: string; symbols: string[]; startingCashCents?: number },
  repo: BacktestRepo
): void {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'backtest.ts');
  const cash = config.startingCashCents ? Math.floor(config.startingCashCents / 100) : 100000;

  const args = [
    scriptPath,
    '--start', config.startDate,
    '--end', config.endDate,
    '--symbols', config.symbols.join(','),
    '--cash', cash.toString(),
    '--backtest-id', backtestId,
  ];

  log.info('spawning backtest CLI', { backtestId, symbols: config.symbols.length });

  const child = spawn('npx', ['tsx', ...args], {
    cwd: path.join(__dirname, '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';

  child.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('close', (code) => {
    if (code === 0) {
      log.info('backtest CLI completed', { backtestId });
    } else {
      const errorMsg = stderr || `CLI exited with code ${code}`;
      log.error('backtest CLI failed', { backtestId, code });
      repo.updateRunStatus(backtestId, 'failed', errorMsg.slice(0, 1000));
    }
  });

  child.on('error', (err) => {
    log.error('backtest CLI spawn error', { backtestId, error: err.message });
    repo.updateRunStatus(backtestId, 'failed', err.message);
  });
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

  // Spawn CLI and clean up fingerprint when done
  spawnBacktestCli(backtestId, {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    symbols: allSymbols,
  }, backtestRepo);

  // Remove fingerprint after a reasonable timeout (CLI will update status)
  setTimeout(() => {
    runningBacktests.delete(fingerprint);
  }, 60 * 60 * 1000); // 1 hour max
}
