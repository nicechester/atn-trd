/**
 * Daily tranche executor job.
 * Runs daily to execute tranches for active strategic plans.
 * Logs detailed "why no trade" audit trail.
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
import { RunsRepo, type RunTrigger } from '../../repos/runsRepo.js';
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

export interface TrancheExecutionSummary {
  regime: string;
  activePlans: number;
  tranchesExecuted: number;
  tranchesSkipped: Array<{ symbol: string; planId: string; reason: string }>;
  plansPaused: number;
  plansResumed: number;
  plansCancelled: number;
  autoTrimPlans: number;
}

export async function runTrancheExecutorJob(
  db: Database.Database,
  trigger: RunTrigger = 'tranche_execution'
): Promise<TrancheExecutionSummary> {
  const now = new Date();
  const settings = getSettings();
  const runsRepo = new RunsRepo(db);

  const summary: TrancheExecutionSummary = {
    regime: 'UNKNOWN',
    activePlans: 0,
    tranchesExecuted: 0,
    tranchesSkipped: [],
    plansPaused: 0,
    plansResumed: 0,
    plansCancelled: 0,
    autoTrimPlans: 0,
  };

  // Create run record
  const runId = runsRepo.create({
    trigger,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    model: null,
    settingsSnapshot: JSON.stringify(settings),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null,
  });

  try {
    if (!isTradingDay(now) && trigger !== 'manual') {
      runsRepo.setSkipped(runId, 'not a trading day');
      return summary;
    }

    if (!settings.execution.enabled) {
      runsRepo.setSkipped(runId, 'execution disabled');
      return summary;
    }

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
    summary.plansPaused = checkAndPausePlansForRegime(deps);
    summary.plansResumed = checkAndResumePlansForRegime(deps);

    // 2. If RISK_OFF, create auto-trim plans for hedging liquidity
    const regime = getCurrentRegime(marketRegimeRepo);
    summary.regime = regime;

    if (regime === 'RISK_OFF' && settings.hedging.autoTrimForCash) {
      const streak = marketRegimeRepo.getRegimeStreak('RISK_OFF');
      if (streak >= settings.hedging.minRiskOffStreak) {
        const trimResult = createAutoTrimPlans(deps);
        summary.autoTrimPlans = trimResult.trimPlansCreated;
      }
    }

    // 3. Check signals and cancel degraded plans
    summary.plansCancelled = checkAndCancelPlansForSignal(deps);

    // 4. Execute tranches for active plans
    const activePlans = strategicPlansRepo.listActive();
    summary.activePlans = activePlans.length;

    const portfolio = portfolioRepo.read();

    for (const plan of activePlans) {
      const { execute, reason } = shouldExecuteTranche(deps, plan);

      if (!execute) {
        summary.tranchesSkipped.push({
          symbol: plan.symbol,
          planId: plan.id,
          reason: reason || 'unknown',
        });

        log.debug('tranche skipped', { planId: plan.id, symbol: plan.symbol, reason });

        // Cancel if signal dropped below threshold
        if (reason?.includes('cancel threshold')) {
          cancelPlan(deps, plan.id, reason);
          summary.plansCancelled++;
        }

        continue;
      }

      // Get current price
      const price = pricesRepo.getLatest(plan.symbol);
      if (!price) {
        summary.tranchesSkipped.push({
          symbol: plan.symbol,
          planId: plan.id,
          reason: 'no price available',
        });
        log.warn('no price available', { symbol: plan.symbol });
        continue;
      }

      // Execute tranche with budget awareness (handles chunky stocks)
      const result = executeTranche(
        deps,
        plan,
        price.adjCloseCents,
        portfolio?.cashCents
      );

      if (result) {
        summary.tranchesExecuted++;
      } else {
        summary.tranchesSkipped.push({
          symbol: plan.symbol,
          planId: plan.id,
          reason: 'execution returned null',
        });
      }
    }

    runsRepo.updateStatus(runId, 'succeeded');
    runsRepo.updateSummary(runId, JSON.stringify(summary));

    log.info('tranche executor job complete', {
      activePlans: summary.activePlans,
      tranchesExecuted: summary.tranchesExecuted,
      tranchesSkipped: summary.tranchesSkipped.length,
    });

    return summary;
  } catch (err) {
    runsRepo.updateStatus(runId, 'failed', err instanceof Error ? err.message : String(err));
    log.error('tranche executor job failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
