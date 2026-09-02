/**
 * Daily tranche executor job.
 * Runs daily to execute tranches for active strategic plans.
 */

import type Database from 'better-sqlite3';
import { isTradingDay } from '../marketCalendar.js';
import { logger } from '../../lib/logger.js';
import { SignalSnapshotsRepo } from '../../repos/signalSnapshotsRepo.js';
import { StrategicPlansRepo } from '../../repos/strategicPlansRepo.js';
import { PlanTranchesRepo } from '../../repos/planTranchesRepo.js';
import { MarketRegimeRepo } from '../../repos/marketRegimeRepo.js';
import { PortfolioRepo } from '../../repos/portfolioRepo.js';
import { PricesRepo } from '../../repos/pricesRepo.js';
import { PositionsRepo } from '../../repos/positionsRepo.js';
import {
  shouldExecuteTranche,
  executeTranche,
  checkAndPausePlansForRegime,
  checkAndResumePlansForRegime,
  checkAndCancelPlansForSignal,
  createAutoTrimPlans,
  cancelPlan,
  type StrategicPlanDeps,
} from '../../services/strategicPlanService.js';
import { getCurrentRegime } from '../../services/regimeDetectionService.js';
import { getSettings } from '../../config/settingsService.js';

const log = logger.child({ component: 'tranche-executor-job' });

export async function runTrancheExecutorJob(db: Database.Database): Promise<void> {
  const now = new Date();

  if (!isTradingDay(now)) {
    log.info('not a trading day, skipping tranche execution');
    return;
  }

  const settings = getSettings();
  if (!settings.execution.enabled) {
    log.info('execution disabled in settings');
    return;
  }

  try {
    const signalSnapshotsRepo = new SignalSnapshotsRepo(db);
    const strategicPlansRepo = new StrategicPlansRepo(db);
    const planTranchesRepo = new PlanTranchesRepo(db);
    const marketRegimeRepo = new MarketRegimeRepo(db);
    const portfolioRepo = new PortfolioRepo(db);
    const pricesRepo = new PricesRepo(db);
    const positionsRepo = new PositionsRepo(db);

    const deps: StrategicPlanDeps = {
      strategicPlansRepo,
      planTranchesRepo,
      signalSnapshotsRepo,
      marketRegimeRepo,
      portfolioRepo,
      pricesRepo,
      positionsRepo,
      getSettings,
    };

    // 1. Check regime and pause/resume plans accordingly
    checkAndPausePlansForRegime(deps);
    checkAndResumePlansForRegime(deps);

    // 2. If RISK_OFF, create auto-trim plans for hedging liquidity
    const regime = getCurrentRegime(marketRegimeRepo);
    if (regime === 'RISK_OFF' && settings.hedging.autoTrimForCash) {
      const streak = marketRegimeRepo.getRegimeStreak('RISK_OFF');
      if (streak >= settings.hedging.minRiskOffStreak) {
        createAutoTrimPlans(deps);
      }
    }

    // 3. Check signals and cancel degraded plans
    checkAndCancelPlansForSignal(deps);

    // 4. Execute tranches for active plans
    const activePlans = strategicPlansRepo.listActive();
    const portfolio = portfolioRepo.read();
    let tranchesExecuted = 0;
    let tranchesSkipped = 0;

    for (const plan of activePlans) {
      const { execute, reason } = shouldExecuteTranche(deps, plan);

      if (!execute) {
        log.debug('tranche skipped', { planId: plan.id, symbol: plan.symbol, reason });

        // Cancel if signal dropped below threshold
        if (reason?.includes('cancel threshold')) {
          cancelPlan(deps, plan.id, reason);
        }

        tranchesSkipped++;
        continue;
      }

      // Get current price
      const price = pricesRepo.getLatest(plan.symbol);
      if (!price) {
        log.warn('no price available', { symbol: plan.symbol });
        tranchesSkipped++;
        continue;
      }

      // Execute tranche with budget awareness (handles chunky stocks)
      const result = executeTranche(
        deps,
        plan,
        price.adjCloseCents,
        portfolio?.cashCents // Pass available cash for budget-aware calculation
      );

      if (result) {
        tranchesExecuted++;
      } else {
        tranchesSkipped++;
      }
    }

    log.info('tranche executor job complete', {
      activePlans: activePlans.length,
      tranchesExecuted,
      tranchesSkipped,
    });
  } catch (err) {
    log.error('tranche executor job failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
