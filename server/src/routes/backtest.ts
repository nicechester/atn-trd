import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BacktestRepo } from '../repos/backtestRepo.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'backtest-routes' });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run backtest CLI in background.
 * Spawns the CLI script which uses FNSPID data + signal-based trading logic.
 */
function runBacktestCli(
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
  ];

  log.info('spawning backtest CLI', { backtestId, args });

  const child = spawn('npx', ['tsx', ...args], {
    cwd: path.join(__dirname, '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BACKTEST_ID: backtestId },
  });

  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', (data) => {
    stdout += data.toString();
  });

  child.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('close', (code) => {
    if (code === 0) {
      log.info('backtest CLI completed', { backtestId });
      // CLI already updates the DB, but ensure status is set
      const run = repo.getRun(backtestId);
      if (run?.status === 'running') {
        repo.updateRunStatus(backtestId, 'succeeded');
      }
    } else {
      const errorMsg = stderr || `CLI exited with code ${code}`;
      log.error('backtest CLI failed', { backtestId, code, stderr: stderr.slice(-500) });
      repo.updateRunStatus(backtestId, 'failed', errorMsg.slice(0, 1000));
    }
  });

  child.on('error', (err) => {
    log.error('backtest CLI spawn error', { backtestId, error: err.message });
    repo.updateRunStatus(backtestId, 'failed', err.message);
  });
}

const BacktestRequestSchema = z.object({
  name: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbols: z.array(z.string().toUpperCase()).min(1),
  startingCashCents: z.number().int().positive().optional(),
});

export function createBacktestRoutes(db: Database.Database): Router {
  const router = Router();
  const repo = new BacktestRepo(db);

  // Get available date range for backtesting (from FNSPID data)
  router.get('/date-range', (_req: Request, res: Response) => {
    // FNSPID sentiment data range (news_sentiment table)
    // Prices go back to 1962, but sentiment only covers 2021-2023
    res.json({
      minDate: '2021-01-01',
      maxDate: '2023-12-28',
      note: 'Date range limited by FNSPID sentiment data availability',
    });
  });

  // List backtest runs
  router.get('/', (_req: Request, res: Response) => {
    try {
      const runs = repo.listRuns(50);
      res.json({ runs });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get backtest run details
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const run = repo.getRun(req.params.id);
      if (!run) {
        res.status(404).json({ error: 'Backtest not found' });
        return;
      }

      const metrics = repo.getMetrics(req.params.id);
      const snapshots = repo.getSnapshots(req.params.id);
      const rawTrades = repo.getTrades(req.params.id);

      // Map snapshots to equity curve format
      const equityCurve = snapshots.map(s => ({
        date: s.asOfDate,
        value: s.totalValueCents / 100,
        benchmark: s.benchmarkValueCents ? s.benchmarkValueCents / 100 : null,
      }));

      // Map trades to expected format
      const trades = rawTrades.map(t => ({
        date: t.tradeDate,
        symbol: t.symbol,
        side: t.side,
        qty: t.qty,
        price: t.priceCents / 100,
        rationale: t.rationale,
      }));

      // Parse settings snapshot
      let settingsSnapshot = null;
      try {
        settingsSnapshot = JSON.parse(run.settingsSnapshot);
      } catch {
        // Invalid JSON, leave as null
      }

      res.json({
        run: { ...run, settingsSnapshot },
        metrics,
        equityCurve,
        trades,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Start a new backtest (async - returns immediately, runs CLI in background)
  router.post('/', (req: Request, res: Response) => {
    const parsed = BacktestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const config = parsed.data;

    // Ensure SPY is included for benchmark
    const allSymbols = config.symbols.includes('SPY') 
      ? config.symbols 
      : [...config.symbols, 'SPY'];

    // Create the backtest record immediately with 'running' status
    const backtestId = repo.createRun({
      name: config.name,
      startDate: config.startDate,
      endDate: config.endDate,
      symbols: allSymbols,
      settingsSnapshot: '{}',
    });

    // Return immediately
    res.status(202).json({ backtestId, status: 'running' });

    // Spawn CLI in background
    runBacktestCli(backtestId, { ...config, symbols: allSymbols }, repo);
  });

  // Get backtest metrics
  router.get('/:id/metrics', (req: Request, res: Response) => {
    try {
      const metrics = repo.getMetrics(req.params.id);
      if (!metrics) {
        res.status(404).json({ error: 'Metrics not found' });
        return;
      }
      res.json(metrics);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get backtest equity curve (snapshots)
  router.get('/:id/equity', (req: Request, res: Response) => {
    try {
      const snapshots = repo.getSnapshots(req.params.id);
      const equityCurve = snapshots.map(s => ({
        date: s.asOfDate,
        value: s.totalValueCents / 100,
        benchmark: s.benchmarkValueCents ? s.benchmarkValueCents / 100 : null,
      }));
      res.json({ equityCurve });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get backtest trades
  router.get('/:id/trades', (req: Request, res: Response) => {
    try {
      const trades = repo.getTrades(req.params.id);
      const mapped = trades.map(t => ({
        date: t.tradeDate,
        symbol: t.symbol,
        side: t.side,
        qty: t.qty,
        price: t.priceCents / 100,
        rationale: t.rationale,
      }));
      res.json({ trades: mapped });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
