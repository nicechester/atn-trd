import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { StrategicPlansRepo } from '../repos/strategicPlansRepo.js';
import { PlanTranchesRepo } from '../repos/planTranchesRepo.js';
import { MarketRegimeRepo } from '../repos/marketRegimeRepo.js';
import { SignalSnapshotsRepo } from '../repos/signalSnapshotsRepo.js';
import { NotFoundError } from '../lib/errors.js';

/** GET /api/plans - List all plans (active + paused) */
export function listPlansHandler(_req: Request, res: Response, next: NextFunction): void {
  try {
    const db = getDatabase();
    const plansRepo = new StrategicPlansRepo(db);

    const active = plansRepo.listActive();
    const paused = plansRepo.listPaused();

    res.json({
      ok: true,
      data: {
        active,
        paused,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/plans/:id - Get plan detail with tranches */
export function getPlanHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const { id } = req.params;
    const db = getDatabase();
    const plansRepo = new StrategicPlansRepo(db);
    const tranchesRepo = new PlanTranchesRepo(db);

    const plan = plansRepo.get(id);
    if (!plan) {
      throw new NotFoundError('Plan not found');
    }

    const tranches = tranchesRepo.listByPlan(id);

    res.json({
      ok: true,
      data: {
        plan,
        tranches,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/regime/current - Get current market regime with streak */
export function getCurrentRegimeHandler(_req: Request, res: Response, next: NextFunction): void {
  try {
    const db = getDatabase();
    const regimeRepo = new MarketRegimeRepo(db);

    const latest = regimeRepo.getLatest();
    if (!latest) {
      res.json({
        ok: true,
        data: null,
      });
      return;
    }

    const streak = regimeRepo.getRegimeStreak(latest.regime);

    res.json({
      ok: true,
      data: {
        ...latest,
        streak,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/signals/:symbol - Get signal history for a symbol */
export function getSignalHistoryHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const { symbol } = req.params;
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '30', 10), 1), 100);

    const db = getDatabase();
    const signalsRepo = new SignalSnapshotsRepo(db);

    const signals = signalsRepo.listBySymbol(symbol.toUpperCase(), limit);

    res.json({
      ok: true,
      data: signals,
    });
  } catch (err) {
    next(err);
  }
}
