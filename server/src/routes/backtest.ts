import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { BacktestRepo } from '../repos/backtestRepo.js';

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
      const trades = repo.getTrades(req.params.id);

      res.json({ run, metrics, snapshots, trades });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Start a new backtest (placeholder - actual execution requires full deps)
  router.post('/', (req: Request, res: Response) => {
    try {
      const parsed = BacktestRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
        return;
      }

      // For now, just validate and return - actual backtest execution
      // requires full trading cycle dependencies
      res.status(501).json({
        error: 'Backtest execution not yet implemented via API',
        message: 'Use the CLI or programmatic interface to run backtests',
        config: parsed.data,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
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
