/**
 * Plan review job.
 * Can run weekly (via weeklyPlanner) or on-demand.
 * Evaluates watchlist signals and creates/updates strategic plans.
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
import { PositionsRepo } from '../../repos/positionsRepo.js';
import { RunsRepo, type RunTrigger } from '../../repos/runsRepo.js';
import { createPlan, type StrategicPlanDeps } from '../../services/strategicPlanService.js';
import { getCurrentRegime } from '../../services/regimeDetectionService.js';
import { getSettings } from '../../config/settingsService.js';

const log = logger.child({ component: 'plan-review-job' });

// Threshold for "chunky" stocks - use budget-based plans above this price
const CHUNKY_STOCK_THRESHOLD_CENTS = 50000; // $500

export interface PlanReviewSummary {
  regime: string;
  watchlistCount: number;
  positionsCount: number;
  plansCreated: number;
  trimPlansCreated: number;
  plansSkipped: Array<{ symbol: string; reason: string }>;
  existingActivePlans: number;
  symbolsPruned: string[];
}

function computeTargetAllocation(
  portfolioValueCents: number,
  priceCents: number,
  conviction: number,
  maxPositionWeight: number
): { targetShares?: number; targetBudgetCents?: number } {
  const baseWeight = 0.05;
  const convictionMultiplier = 0.5 + conviction;
  const targetWeight = Math.min(baseWeight * convictionMultiplier, maxPositionWeight / 100);
  const targetValueCents = portfolioValueCents * targetWeight;

  if (priceCents >= CHUNKY_STOCK_THRESHOLD_CENTS) {
    return { targetBudgetCents: Math.round(targetValueCents) };
  }

  const targetShares = Math.floor(targetValueCents / priceCents);
  return { targetShares };
}

export async function runPlanReviewJob(
  db: Database.Database,
  trigger: RunTrigger = 'plan_review'
): Promise<PlanReviewSummary> {
  const now = new Date();
  const settings = getSettings();
  const runsRepo = new RunsRepo(db);

  const summary: PlanReviewSummary = {
    regime: 'UNKNOWN',
    watchlistCount: 0,
    positionsCount: 0,
    plansCreated: 0,
    trimPlansCreated: 0,
    plansSkipped: [],
    existingActivePlans: 0,
    symbolsPruned: [],
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
    const watchlistRepo = new WatchlistRepo(db);
    const positionsRepo = new PositionsRepo(db);

    const deps: StrategicPlanDeps = {
      strategicPlansRepo,
      planTranchesRepo,
      signalSnapshotsRepo,
      marketRegimeRepo,
      portfolioRepo,
      pricesRepo,
      getSettings,
    };

    // Check regime
    const regime = getCurrentRegime(marketRegimeRepo);
    summary.regime = regime;

    if (regime === 'RISK_OFF' && settings.execution.requireRegimeCheck) {
      runsRepo.setSkipped(runId, 'RISK_OFF regime - no new ACCUMULATE plans');
      runsRepo.updateSummary(runId, JSON.stringify(summary));
      return summary;
    }

    const portfolio = portfolioRepo.read();
    if (!portfolio) {
      runsRepo.setSkipped(runId, 'no portfolio found');
      return summary;
    }

    const watchlist = watchlistRepo.list().filter(w => w.enabled);
    const positions = positionsRepo.list();
    summary.watchlistCount = watchlist.length;
    summary.positionsCount = positions.length;
    summary.existingActivePlans = strategicPlansRepo.listActive().length;

    // --- ACCUMULATE plans from watchlist ---
    for (const item of watchlist) {
      // Skip if active plan exists
      const existingPlan = strategicPlansRepo.getActiveBySymbol(item.symbol);
      if (existingPlan) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: 'active plan exists' });
        continue;
      }

      // Get latest signal
      const signal = signalSnapshotsRepo.getLatest(item.symbol);
      if (!signal) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: 'no signal data' });
        continue;
      }

      const score = signal.compositeEwma ?? signal.compositeScore;
      if (score === null) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: 'no composite score' });
        continue;
      }

      // Check buy threshold
      if (score < settings.signals.buyThreshold) {
        summary.plansSkipped.push({
          symbol: item.symbol,
          reason: `score ${score.toFixed(2)} < threshold ${settings.signals.buyThreshold}`,
        });
        continue;
      }

      const price = pricesRepo.getLatest(item.symbol);
      if (!price) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: 'no price data' });
        continue;
      }

      const conviction = Math.min(1, (score - settings.signals.buyThreshold) / (1 - settings.signals.buyThreshold));
      const allocation = computeTargetAllocation(
        portfolio.cashCents,
        price.adjCloseCents,
        conviction,
        settings.risk.maxPositionWeightPercent
      );

      // Skip if allocation too small
      if (allocation.targetShares !== undefined && allocation.targetShares < 1) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: 'allocation too small (< 1 share)' });
        continue;
      }
      if (allocation.targetBudgetCents !== undefined && allocation.targetBudgetCents < price.adjCloseCents) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: 'budget insufficient for 1 share' });
        continue;
      }

      createPlan(deps, {
        symbol: item.symbol,
        direction: 'ACCUMULATE',
        targetShares: allocation.targetShares,
        targetBudgetCents: allocation.targetBudgetCents,
        entryCompositeScore: score,
        conviction,
      });

      summary.plansCreated++;
    }

    // --- TRIM plans from positions with bearish signals ---
    for (const position of positions) {
      // Skip if active plan exists (ACCUMULATE or TRIM)
      const existingPlan = strategicPlansRepo.getActiveBySymbol(position.symbol);
      if (existingPlan) {
        // Don't add to skipped - already counted above if in watchlist
        continue;
      }

      // Get latest signal
      const signal = signalSnapshotsRepo.getLatest(position.symbol);
      if (!signal) {
        summary.plansSkipped.push({ symbol: position.symbol, reason: 'position: no signal data' });
        continue;
      }

      const score = signal.compositeEwma ?? signal.compositeScore;
      if (score === null) {
        summary.plansSkipped.push({ symbol: position.symbol, reason: 'position: no composite score' });
        continue;
      }

      // Check sell threshold (negative score = bearish)
      if (score > settings.signals.sellThreshold) {
        summary.plansSkipped.push({
          symbol: position.symbol,
          reason: `position: score ${score.toFixed(2)} > sell threshold ${settings.signals.sellThreshold}`,
        });
        continue;
      }

      const price = pricesRepo.getLatest(position.symbol);
      if (!price) {
        summary.plansSkipped.push({ symbol: position.symbol, reason: 'position: no price data' });
        continue;
      }

      // Create TRIM plan for full position
      const conviction = Math.min(1, Math.abs(score - settings.signals.sellThreshold) / Math.abs(settings.signals.sellThreshold));

      createPlan(deps, {
        symbol: position.symbol,
        direction: 'TRIM',
        targetShares: position.qty,
        entryCompositeScore: score,
        conviction,
      });

      summary.trimPlansCreated++;
    }

    // --- PRUNE watchlist symbols with sustained negative scores ---
    if (settings.watchlist.pruning.enabled) {
      const { scoreThreshold, consecutiveDaysBelow } = settings.watchlist.pruning;
      const positionSymbols = new Set(positions.map(p => p.symbol));
      const activeplanSymbols = new Set(strategicPlansRepo.listActive().map(p => p.symbol));

      for (const item of watchlist) {
        // Skip if we hold a position
        if (positionSymbols.has(item.symbol)) continue;
        // Skip if there's an active plan
        if (activeplanSymbols.has(item.symbol)) continue;

        // Check recent signals
        const snapshots = signalSnapshotsRepo.getRecentSnapshots(item.symbol, consecutiveDaysBelow);
        if (snapshots.length < consecutiveDaysBelow) continue;

        // Check if all recent scores are below threshold
        const allBelowThreshold = snapshots.every(s => {
          const score = s.compositeEwma ?? s.compositeScore;
          return score !== null && score < scoreThreshold;
        });

        if (allBelowThreshold) {
          watchlistRepo.removeSymbol(item.symbol);
          summary.symbolsPruned.push(item.symbol);
          log.info('pruned watchlist symbol', {
            symbol: item.symbol,
            reason: `score below ${scoreThreshold} for ${consecutiveDaysBelow} consecutive days`,
          });
        }
      }
    }

    runsRepo.updateStatus(runId, 'succeeded');
    runsRepo.updateSummary(runId, JSON.stringify(summary));

    log.info('plan review job complete', { ...summary });
    return summary;
  } catch (err) {
    runsRepo.updateStatus(runId, 'failed', err instanceof Error ? err.message : String(err));
    log.error('plan review job failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
