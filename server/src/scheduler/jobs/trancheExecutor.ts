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
import {
  shouldExecuteTranche,
  executeTranche,
  checkAndPausePlansForRegime,
  checkAndResumePlansForRegime,
  checkAndCancelPlansForSignal,
  cancelPlan,
  type StrategicPlanDeps,
} from '../../services/strategicPlanService.js';
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

    const deps: StrategicPlanDeps = {
      strategicPlansRepo,
      planTranchesRepo,
      signalSnapshotsRepo,
      marketRegimeRepo,
      portfolioRepo,
      pricesRepo,
      getSettings,
    };

    // 1. Check regime and pause/resume plans accordingly
    checkAndPausePlansForRegime(deps);
    checkAndResumePlansForRegime(deps);

    // 2. Check signals and cancel degraded plans
    checkAndCancelPlansForSignal(deps);

    // 3. Execute tranches for active plans
    const activePlans = strategicPlansRepo.listActive();
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

      // Execute tranche (paper mode - no actual order)
      // In a real implementation, this would create an order via the broker
      executeTranche(deps, plan, price.adjCloseCents);
      tranchesExecuted++;
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
