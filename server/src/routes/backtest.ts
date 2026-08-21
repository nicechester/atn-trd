import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { BacktestRepo } from '../repos/backtestRepo.js';
import { BacktestRunner, type BacktestDeps } from '../backtest/runner.js';
import { createHistoricalPriceProvider, createBenchmarkPriceProvider } from '../backtest/priceProvider.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { SettingsRepo } from '../repos/settingsRepo.js';
import { DEFAULT_SETTINGS } from '@atn-trd/shared';
import { logger } from '../lib/logger.js';
import { runPriceBackfillJob } from '../scheduler/jobs/priceBackfill.js';

const log = logger.child({ component: 'backtest-routes' });

/**
 * Run backtest in background (fire-and-forget from HTTP handler).
 */
async function runBacktestAsync(
  db: Database.Database,
  backtestId: string,
  config: { name?: string; startDate: string; endDate: string; symbols: string[]; startingCashCents?: number }
): Promise<void> {
  const repo = new BacktestRepo(db);

  try {
    // Pre-backfill missing price data via Alpaca (use backtest start date)
    log.info('backfilling price data for backtest', { backtestId, symbols: config.symbols.length, startDate: config.startDate });
    await runPriceBackfillJob(db, { symbols: config.symbols, startDate: config.startDate });
    log.info('backfill complete', { backtestId });

    // Load settings
    const settingsRepo = new SettingsRepo(db);
    const settingsRow = settingsRepo.read();
    const settings = settingsRow ? JSON.parse(settingsRow.doc) : DEFAULT_SETTINGS;

    // Create price providers
    const pricesRepo = new PricesRepo(db);
    const priceProvider = createHistoricalPriceProvider(pricesRepo);
    const getBenchmarkPrice = createBenchmarkPriceProvider(pricesRepo);

    // Simple buy-and-hold strategy
    const runTradingLogic: BacktestDeps['runTradingLogic'] = async ({ date, symbols, broker }) => {
      const positions = broker.getPositionsSnapshot();
      if (Object.keys(positions).length === 0) {
        const cashCents = broker.getCashCents();
        const perSymbolCents = Math.floor(cashCents / symbols.length);

        for (const symbol of symbols) {
          const price = await priceProvider.getPrice(symbol, date);
          if (price && price.openCents > 0) {
            const qty = Math.floor(perSymbolCents / price.openCents);
            if (qty > 0) {
              await broker.submitOrder({
                clientOrderId: `bt-${date}-${symbol}`,
                symbol,
                side: 'buy',
                qty,
                type: 'market',
                tif: 'day',
              });
            }
          }
        }
      }
    };

    const deps: BacktestDeps = { db, priceProvider, getBenchmarkPrice, runTradingLogic, settings };
    const runner = new BacktestRunner(deps);

    log.info('starting backtest execution', { backtestId });
    await runner.run({ ...config, backtestId });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error('backtest async execution failed', { backtestId, error: errorMsg });
    repo.updateRunStatus(backtestId, 'failed', errorMsg);
  }
}

const BacktestRequestSchema = z.object({
  name: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbols: z.array(z.string().toUpperCase()).min(1),
  startingCashCents: z.number().int().positive().optional(),
  slippageBps: z.number().int().min(0).max(100).optional(),
});

export function createBacktestRoutes(db: Database.Database): Router {
  const router = Router();
  const repo = new BacktestRepo(db);

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

      res.json({ run, metrics, equityCurve, trades });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Start a new backtest (async - returns immediately, runs in background)
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

    // Run backtest in background
    runBacktestAsync(db, backtestId, { ...config, symbols: allSymbols }).catch(err => {
      log.error('background backtest failed', { backtestId, error: err instanceof Error ? err.message : String(err) });
    });
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
