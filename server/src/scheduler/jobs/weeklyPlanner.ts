/**
 * Weekly planner job.
 * Runs weekly to evaluate watchlist symbols and create strategic plans
 * when signal thresholds are crossed.
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
import { WatchlistRepo } from '../../repos/watchlistRepo.js';
import { createPlan, type StrategicPlanDeps } from '../../services/strategicPlanService.js';
import { getCurrentRegime } from '../../services/regimeDetectionService.js';
import { getSettings } from '../../config/settingsService.js';

const log = logger.child({ component: 'weekly-planner-job' });

// Threshold for "chunky" stocks - use budget-based plans above this price
const CHUNKY_STOCK_THRESHOLD_CENTS = 50000; // $500

/**
 * Compute target allocation for a symbol.
 * Returns either targetShares or targetBudgetCents based on stock price.
 */
function computeTargetAllocation(
  portfolioValueCents: number,
  priceCents: number,
  conviction: number,
  maxPositionWeight: number
): { targetShares?: number; targetBudgetCents?: number } {
  // Base allocation: 5% of portfolio, scaled by conviction (0.5-1.5x)
  const baseWeight = 0.05;
  const convictionMultiplier = 0.5 + conviction; // conviction 0-1 maps to 0.5-1.5x
  const targetWeight = Math.min(baseWeight * convictionMultiplier, maxPositionWeight / 100);
  const targetValueCents = portfolioValueCents * targetWeight;

  // For expensive stocks, use budget-based targeting
  if (priceCents >= CHUNKY_STOCK_THRESHOLD_CENTS) {
    return { targetBudgetCents: Math.round(targetValueCents) };
  }

  // For normal stocks, use share-based targeting
  const targetShares = Math.floor(targetValueCents / priceCents);
  return { targetShares };
}

export async function runWeeklyPlannerJob(db: Database.Database): Promise<void> {
  const now = new Date();

  if (!isTradingDay(now)) {
    log.info('not a trading day, skipping weekly planner');
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
    const watchlistRepo = new WatchlistRepo(db);

    const deps: StrategicPlanDeps = {
      strategicPlansRepo,
      planTranchesRepo,
      signalSnapshotsRepo,
      marketRegimeRepo,
      portfolioRepo,
      pricesRepo,
      getSettings,
    };

    // Check regime - don't create new ACCUMULATE plans in RISK_OFF
    const regime = getCurrentRegime(marketRegimeRepo);
    if (regime === 'RISK_OFF' && settings.execution.requireRegimeCheck) {
      log.info('RISK_OFF regime, skipping plan creation');
      return;
    }

    const portfolio = portfolioRepo.read();
    if (!portfolio) {
      log.warn('no portfolio found');
      return;
    }

    const watchlist = watchlistRepo.list().filter(w => w.enabled);
    let plansCreated = 0;

    for (const item of watchlist) {
      // Skip if active plan exists
      const existingPlan = strategicPlansRepo.getActiveBySymbol(item.symbol);
      if (existingPlan) continue;

      // Get latest signal
      const signal = signalSnapshotsRepo.getLatest(item.symbol);
      if (!signal) continue;

      const score = signal.compositeEwma ?? signal.compositeScore;
      if (score === null) continue;

      // Check buy threshold
      if (score >= settings.signals.buyThreshold) {
        const price = pricesRepo.getLatest(item.symbol);
        if (!price) continue;

        const conviction = Math.min(1, (score - settings.signals.buyThreshold) / (1 - settings.signals.buyThreshold));
        const allocation = computeTargetAllocation(
          portfolio.cashCents,
          price.adjCloseCents,
          conviction,
          settings.risk.maxPositionWeightPercent
        );

        // Skip if allocation too small
        if (allocation.targetShares !== undefined && allocation.targetShares < 1) continue;
        if (allocation.targetBudgetCents !== undefined && allocation.targetBudgetCents < price.adjCloseCents) continue;

        createPlan(deps, {
          symbol: item.symbol,
          direction: 'ACCUMULATE',
          targetShares: allocation.targetShares,
          targetBudgetCents: allocation.targetBudgetCents,
          entryCompositeScore: score,
          conviction,
        });

        plansCreated++;
      }
    }

    log.info('weekly planner job complete', { plansCreated, regime });
  } catch (err) {
    log.error('weekly planner job failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
