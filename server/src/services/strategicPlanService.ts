/**
 * Strategic Plan Service
 *
 * Manages multi-week accumulation/trim campaigns with tranched execution.
 * Plans are created when signal thresholds are crossed and execute over time.
 */

import { randomUUID } from 'crypto';
import type { Settings } from '@atn-trd/shared';
import { logger } from '../lib/logger.js';
import type { StrategicPlansRepo, StrategicPlanRow, PlanDirection } from '../repos/strategicPlansRepo.js';
import type { PlanTranchesRepo, PlanTrancheRow } from '../repos/planTranchesRepo.js';
import type { SignalSnapshotsRepo } from '../repos/signalSnapshotsRepo.js';
import type { MarketRegimeRepo } from '../repos/marketRegimeRepo.js';
import type { PortfolioRepo } from '../repos/portfolioRepo.js';
import type { PricesRepo } from '../repos/pricesRepo.js';
import { getCurrentRegime } from './regimeDetectionService.js';

const log = logger.child({ component: 'strategic-plan' });

export interface StrategicPlanDeps {
  strategicPlansRepo: StrategicPlansRepo;
  planTranchesRepo: PlanTranchesRepo;
  signalSnapshotsRepo: SignalSnapshotsRepo;
  marketRegimeRepo: MarketRegimeRepo;
  portfolioRepo: PortfolioRepo;
  pricesRepo: PricesRepo;
  getSettings: () => Settings;
}

export interface CreatePlanParams {
  symbol: string;
  direction: PlanDirection;
  targetShares: number;
  targetWeight?: number;
  trancheCount?: number;
  entryCompositeScore?: number;
  conviction?: number;
}

export interface TrancheResult {
  planId: string;
  symbol: string;
  shares: number;
  priceCents: number;
  trancheNumber: number;
  orderId?: string;
}

// ── Plan Creation ─────────────────────────────────────────────────────────────

export function createPlan(deps: StrategicPlanDeps, params: CreatePlanParams): StrategicPlanRow {
  const { strategicPlansRepo, getSettings } = deps;
  const settings = getSettings();

  // Check for existing active plan
  const existing = strategicPlansRepo.getActiveBySymbol(params.symbol);
  if (existing) {
    throw new Error(`Active plan already exists for ${params.symbol}`);
  }

  const plan: Omit<StrategicPlanRow, 'executedShares' | 'tranchesExecuted' | 'lastTrancheAt' | 'completedAt'> = {
    id: randomUUID(),
    symbol: params.symbol,
    direction: params.direction,
    targetShares: params.targetShares,
    targetWeight: params.targetWeight ?? null,
    trancheCount: params.trancheCount ?? settings.execution.defaultTrancheCount,
    minDaysBetween: settings.execution.minDaysBetweenTranches,
    entryCompositeScore: params.entryCompositeScore ?? null,
    convictionAtCreation: params.conviction ?? null,
    status: 'ACTIVE',
    pauseReason: null,
    createdAt: Date.now(),
  };

  strategicPlansRepo.create(plan);
  log.info('plan created', { id: plan.id, symbol: params.symbol, direction: params.direction, targetShares: params.targetShares });

  return { ...plan, executedShares: 0, tranchesExecuted: 0, lastTrancheAt: null, completedAt: null };
}

// ── Plan Status Management ────────────────────────────────────────────────────

export function pausePlan(deps: StrategicPlanDeps, planId: string, reason: string): void {
  const { strategicPlansRepo } = deps;
  strategicPlansRepo.updateStatus(planId, 'PAUSED', reason);
  log.info('plan paused', { planId, reason });
}

export function resumePlan(deps: StrategicPlanDeps, planId: string): void {
  const { strategicPlansRepo } = deps;
  strategicPlansRepo.updateStatus(planId, 'ACTIVE');
  log.info('plan resumed', { planId });
}

export function completePlan(deps: StrategicPlanDeps, planId: string): void {
  const { strategicPlansRepo } = deps;
  strategicPlansRepo.updateStatus(planId, 'COMPLETED');
  log.info('plan completed', { planId });
}

export function cancelPlan(deps: StrategicPlanDeps, planId: string, reason: string): void {
  const { strategicPlansRepo } = deps;
  strategicPlansRepo.updateStatus(planId, 'CANCELLED', reason);
  log.info('plan cancelled', { planId, reason });
}

// ── Tranche Execution ─────────────────────────────────────────────────────────

function daysSince(timestamp: number | null): number {
  if (!timestamp) return Infinity;
  return Math.floor((Date.now() - timestamp) / 86_400_000);
}

export function shouldExecuteTranche(deps: StrategicPlanDeps, plan: StrategicPlanRow): { execute: boolean; reason?: string } {
  const { signalSnapshotsRepo, getSettings } = deps;
  const settings = getSettings();

  // Check minimum days between tranches
  const daysSinceLastTranche = daysSince(plan.lastTrancheAt);
  if (daysSinceLastTranche < plan.minDaysBetween) {
    return { execute: false, reason: `only ${daysSinceLastTranche} days since last tranche (min: ${plan.minDaysBetween})` };
  }

  // Check if all tranches executed
  if (plan.tranchesExecuted >= plan.trancheCount) {
    return { execute: false, reason: 'all tranches executed' };
  }

  // Check if signal still valid (for ACCUMULATE plans)
  if (plan.direction === 'ACCUMULATE') {
    const signal = signalSnapshotsRepo.getLatest(plan.symbol);
    const score = signal?.compositeEwma ?? signal?.compositeScore;

    if (score !== null && score !== undefined) {
      // Cancel if score dropped below cancel threshold
      if (score < settings.signals.cancelThreshold) {
        return { execute: false, reason: `signal dropped below cancel threshold (${score.toFixed(2)} < ${settings.signals.cancelThreshold})` };
      }
      // Pause if score dropped below pause threshold
      if (score < settings.signals.pauseThreshold) {
        return { execute: false, reason: `signal below pause threshold (${score.toFixed(2)} < ${settings.signals.pauseThreshold})` };
      }
    }
  }

  return { execute: true };
}

export function computeTrancheSize(plan: StrategicPlanRow): number {
  const remainingShares = plan.targetShares - plan.executedShares;
  const remainingTranches = plan.trancheCount - plan.tranchesExecuted;

  if (remainingTranches <= 0) return 0;

  // Equal-weight tranches for simplicity
  return Math.ceil(remainingShares / remainingTranches);
}

export function executeTranche(
  deps: StrategicPlanDeps,
  plan: StrategicPlanRow,
  priceCents: number,
  orderId?: string
): TrancheResult {
  const { strategicPlansRepo, planTranchesRepo, signalSnapshotsRepo, marketRegimeRepo } = deps;

  const shares = computeTrancheSize(plan);
  const trancheNumber = plan.tranchesExecuted + 1;

  // Get current context
  const signal = signalSnapshotsRepo.getLatest(plan.symbol);
  const regime = getCurrentRegime(marketRegimeRepo);

  // Record tranche
  const tranche: PlanTrancheRow = {
    id: randomUUID(),
    planId: plan.id,
    trancheNumber,
    shares,
    priceCents,
    orderId: orderId ?? null,
    compositeScore: signal?.compositeEwma ?? signal?.compositeScore ?? null,
    regime,
    executedAt: Date.now(),
  };

  planTranchesRepo.create(tranche);
  strategicPlansRepo.recordTrancheExecution(plan.id, shares);

  // Check if plan is now complete
  const updatedPlan = strategicPlansRepo.get(plan.id);
  if (updatedPlan && updatedPlan.tranchesExecuted >= updatedPlan.trancheCount) {
    completePlan(deps, plan.id);
  }

  log.info('tranche executed', {
    planId: plan.id,
    symbol: plan.symbol,
    trancheNumber,
    shares,
    priceCents,
    regime,
  });

  return {
    planId: plan.id,
    symbol: plan.symbol,
    shares,
    priceCents,
    trancheNumber,
    orderId,
  };
}

// ── Regime-Based Plan Management ──────────────────────────────────────────────

export function checkAndPausePlansForRegime(deps: StrategicPlanDeps): number {
  const { strategicPlansRepo, marketRegimeRepo, getSettings } = deps;
  const settings = getSettings();

  if (!settings.execution.requireRegimeCheck) return 0;

  const regime = getCurrentRegime(marketRegimeRepo);
  if (regime !== 'RISK_OFF') return 0;

  // Check confirmation streak
  const streak = marketRegimeRepo.getRegimeStreak('RISK_OFF');
  if (streak < settings.regime.confirmationDays) return 0;

  // Pause all active ACCUMULATE plans
  const activePlans = strategicPlansRepo.listActive();
  let pausedCount = 0;

  for (const plan of activePlans) {
    if (plan.direction === 'ACCUMULATE') {
      pausePlan(deps, plan.id, 'regime_risk_off');
      pausedCount++;
    }
  }

  if (pausedCount > 0) {
    log.info('paused plans due to RISK_OFF regime', { count: pausedCount, streak });
  }

  return pausedCount;
}

export function checkAndResumePlansForRegime(deps: StrategicPlanDeps): number {
  const { strategicPlansRepo, marketRegimeRepo } = deps;

  const regime = getCurrentRegime(marketRegimeRepo);
  if (regime === 'RISK_OFF') return 0;

  // Resume plans that were paused due to regime
  const pausedPlans = strategicPlansRepo.listPaused();
  let resumedCount = 0;

  for (const plan of pausedPlans) {
    if (plan.pauseReason === 'regime_risk_off') {
      resumePlan(deps, plan.id);
      resumedCount++;
    }
  }

  if (resumedCount > 0) {
    log.info('resumed plans after regime change', { count: resumedCount, regime });
  }

  return resumedCount;
}

// ── Signal-Based Plan Cancellation ────────────────────────────────────────────

export function checkAndCancelPlansForSignal(deps: StrategicPlanDeps): number {
  const { strategicPlansRepo, signalSnapshotsRepo, getSettings } = deps;
  const settings = getSettings();

  const activePlans = strategicPlansRepo.listActive();
  let cancelledCount = 0;

  for (const plan of activePlans) {
    if (plan.direction !== 'ACCUMULATE') continue;

    const signal = signalSnapshotsRepo.getLatest(plan.symbol);
    const score = signal?.compositeEwma ?? signal?.compositeScore;

    if (score !== null && score !== undefined && score < settings.signals.cancelThreshold) {
      cancelPlan(deps, plan.id, `signal_below_threshold:${score.toFixed(2)}`);
      cancelledCount++;
    }
  }

  if (cancelledCount > 0) {
    log.info('cancelled plans due to signal degradation', { count: cancelledCount });
  }

  return cancelledCount;
}
