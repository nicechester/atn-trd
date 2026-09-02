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
import type { PlanTranchesRepo } from '../repos/planTranchesRepo.js';
import type { SignalSnapshotsRepo } from '../repos/signalSnapshotsRepo.js';
import type { MarketRegimeRepo } from '../repos/marketRegimeRepo.js';
import type { PortfolioRepo } from '../repos/portfolioRepo.js';
import type { PricesRepo } from '../repos/pricesRepo.js';
import type { PositionsRepo } from '../repos/positionsRepo.js';
import { getCurrentRegime } from './regimeDetectionService.js';

const log = logger.child({ component: 'strategic-plan' });

export interface StrategicPlanDeps {
  strategicPlansRepo: StrategicPlansRepo;
  planTranchesRepo: PlanTranchesRepo;
  signalSnapshotsRepo: SignalSnapshotsRepo;
  marketRegimeRepo: MarketRegimeRepo;
  portfolioRepo: PortfolioRepo;
  pricesRepo: PricesRepo;
  positionsRepo?: PositionsRepo; // Optional, needed for auto-trim
  getSettings: () => Settings;
}

export interface CreatePlanParams {
  symbol: string;
  direction: PlanDirection;
  targetShares?: number;
  targetBudgetCents?: number; // Alternative to targetShares for chunky stocks
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

  // Validate: need either targetShares or targetBudgetCents
  if (!params.targetShares && !params.targetBudgetCents) {
    throw new Error('Either targetShares or targetBudgetCents must be provided');
  }

  // Check for existing active plan
  const existing = strategicPlansRepo.getActiveBySymbol(params.symbol);
  if (existing) {
    throw new Error(`Active plan already exists for ${params.symbol}`);
  }

  const plan: Omit<StrategicPlanRow, 'executedShares' | 'tranchesExecuted' | 'lastTrancheAt' | 'completedAt'> = {
    id: randomUUID(),
    symbol: params.symbol,
    direction: params.direction,
    targetShares: params.targetShares ?? 0,
    targetWeight: params.targetWeight ?? null,
    targetBudgetCents: params.targetBudgetCents ?? null,
    trancheCount: params.trancheCount ?? settings.execution.defaultTrancheCount,
    minDaysBetween: settings.execution.minDaysBetweenTranches,
    entryCompositeScore: params.entryCompositeScore ?? null,
    convictionAtCreation: params.conviction ?? null,
    status: 'ACTIVE',
    pauseReason: null,
    createdAt: Date.now(),
  };

  strategicPlansRepo.create(plan);
  log.info('plan created', {
    id: plan.id,
    symbol: params.symbol,
    direction: params.direction,
    targetShares: params.targetShares,
    targetBudgetCents: params.targetBudgetCents,
  });

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

/**
 * Compute tranche shares for budget-based plans (chunky stock handling).
 * Returns null if can't afford even 1 share.
 */
export function computeTrancheSizeWithBudget(
  plan: StrategicPlanRow,
  priceCents: number,
  availableCashCents: number
): { shares: number; reason?: string } {
  const remainingTranches = plan.trancheCount - plan.tranchesExecuted;
  if (remainingTranches <= 0) return { shares: 0, reason: 'all tranches executed' };

  let trancheBudget: number;

  if (plan.targetBudgetCents) {
    // Budget-based: divide remaining budget by remaining tranches
    const executedBudget = plan.executedShares * priceCents; // Approximate
    const remainingBudget = plan.targetBudgetCents - executedBudget;
    trancheBudget = Math.max(0, remainingBudget / remainingTranches);
  } else {
    // Share-based: compute budget from remaining shares
    const remainingShares = plan.targetShares - plan.executedShares;
    trancheBudget = (remainingShares / remainingTranches) * priceCents;
  }

  const maxAffordable = Math.floor(availableCashCents / priceCents);
  const desired = Math.floor(trancheBudget / priceCents);

  if (maxAffordable < 1) {
    return { shares: 0, reason: 'insufficient cash for 1 whole share' };
  }

  const shares = Math.min(desired, maxAffordable);
  if (shares < 1) {
    return { shares: 0, reason: 'tranche budget insufficient for 1 share' };
  }

  return { shares };
}

export function executeTranche(
  deps: StrategicPlanDeps,
  plan: StrategicPlanRow,
  priceCents: number,
  availableCashCents?: number,
  orderId?: string
): TrancheResult | null {
  const { strategicPlansRepo, planTranchesRepo, signalSnapshotsRepo, marketRegimeRepo } = deps;

  // Compute shares - use budget-aware calculation if cash provided
  let shares: number;
  if (availableCashCents !== undefined) {
    const result = computeTrancheSizeWithBudget(plan, priceCents, availableCashCents);
    if (result.shares === 0) {
      log.warn('tranche skipped', { planId: plan.id, symbol: plan.symbol, reason: result.reason });
      return null;
    }
    shares = result.shares;
  } else {
    shares = computeTrancheSize(plan);
    if (shares === 0) {
      log.warn('tranche skipped', { planId: plan.id, symbol: plan.symbol, reason: 'no shares to execute' });
      return null;
    }
  }

  const trancheNumber = plan.tranchesExecuted + 1;

  // Get current context
  const signal = signalSnapshotsRepo.getLatest(plan.symbol);
  const regime = getCurrentRegime(marketRegimeRepo);

  // Record tranche (status starts as PENDING)
  const trancheId = randomUUID();
  planTranchesRepo.create({
    id: trancheId,
    planId: plan.id,
    trancheNumber,
    shares,
    priceCents,
    orderId: orderId ?? null,
    compositeScore: signal?.compositeEwma ?? signal?.compositeScore ?? null,
    regime,
    executedAt: Date.now(),
  });

  // For paper trading, immediately mark as filled and update plan
  // In live trading, this would wait for order confirmation
  planTranchesRepo.updateStatus(trancheId, 'FILLED', shares * priceCents, Date.now());
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

// ── Auto-Trim for Hedging Liquidity ───────────────────────────────────────────

export interface AutoTrimResult {
  trimPlansCreated: number;
  targetCashPercent: number;
  currentCashPercent: number;
  symbols: string[];
}

/**
 * Create TRIM plans for low-conviction positions to free cash for hedging.
 * Called when regime shifts to RISK_OFF and cash is below target.
 */
export function createAutoTrimPlans(deps: StrategicPlanDeps): AutoTrimResult {
  const { strategicPlansRepo, signalSnapshotsRepo, portfolioRepo, positionsRepo, pricesRepo, getSettings } = deps;
  const settings = getSettings();

  const result: AutoTrimResult = {
    trimPlansCreated: 0,
    targetCashPercent: settings.hedging.cashReserveInRiskOff,
    currentCashPercent: 0,
    symbols: [],
  };

  if (!settings.hedging.autoTrimForCash) {
    log.debug('auto-trim disabled');
    return result;
  }

  if (!positionsRepo) {
    log.warn('positionsRepo not provided, cannot auto-trim');
    return result;
  }

  const portfolio = portfolioRepo.read();
  if (!portfolio) {
    log.warn('no portfolio found');
    return result;
  }

  // Calculate current cash percentage
  const positions = positionsRepo.list();
  let totalValueCents = portfolio.cashCents;

  const positionValues: Array<{ symbol: string; valueCents: number; score: number | null }> = [];

  for (const pos of positions) {
    const price = pricesRepo.getLatest(pos.symbol);
    if (!price) continue;

    const valueCents = pos.qty * price.adjCloseCents;
    totalValueCents += valueCents;

    const signal = signalSnapshotsRepo.getLatest(pos.symbol);
    const score = signal?.compositeEwma ?? signal?.compositeScore ?? null;

    positionValues.push({ symbol: pos.symbol, valueCents, score });
  }

  result.currentCashPercent = totalValueCents > 0 ? portfolio.cashCents / totalValueCents : 1;

  if (result.currentCashPercent >= result.targetCashPercent) {
    log.debug('cash already at target', { current: result.currentCashPercent, target: result.targetCashPercent });
    return result;
  }

  // Sort by score ascending (lowest conviction first)
  positionValues.sort((a, b) => (a.score ?? -1) - (b.score ?? -1));

  // Calculate how much cash we need
  const targetCashCents = totalValueCents * result.targetCashPercent;
  let cashNeededCents = targetCashCents - portfolio.cashCents;

  for (const pos of positionValues) {
    if (cashNeededCents <= 0) break;

    // Skip if already has an active plan
    const existingPlan = strategicPlansRepo.getActiveBySymbol(pos.symbol);
    if (existingPlan) {
      // If it's an ACCUMULATE plan, pause it first
      if (existingPlan.direction === 'ACCUMULATE') {
        pausePlan(deps, existingPlan.id, 'auto_trim_for_hedge');
      }
      continue;
    }

    // Create TRIM plan for 50% of position
    const trimValueCents = Math.min(pos.valueCents * 0.5, cashNeededCents);
    const price = pricesRepo.getLatest(pos.symbol);
    if (!price) continue;

    const trimShares = Math.floor(trimValueCents / price.adjCloseCents);
    if (trimShares < 1) continue;

    try {
      createPlan(deps, {
        symbol: pos.symbol,
        direction: 'TRIM',
        targetShares: trimShares,
        entryCompositeScore: pos.score ?? undefined,
        conviction: 0, // Low conviction trim
      });

      cashNeededCents -= trimShares * price.adjCloseCents;
      result.trimPlansCreated++;
      result.symbols.push(pos.symbol);
    } catch (err) {
      log.warn('failed to create trim plan', { symbol: pos.symbol, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (result.trimPlansCreated > 0) {
    log.info('auto-trim plans created for hedging', { ...result });
  }

  return result;
}
