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
  creationNotes?: string; // Audit trail: thesis + scores at creation
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
    creationNotes: params.creationNotes ?? null,
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

// ── Conviction-Scaled Tranche Sizing ──────────────────────────────────────────

/**
 * Compute conviction-scaled tranche size.
 * Higher conviction = larger tranches, lower conviction = smaller tranches.
 * Base size is scaled by (currentScore - 0.5) / 0.5, clamped to [0.2, 1.5].
 */
export function computeConvictionScaledTranche(
  plan: StrategicPlanRow,
  currentScore: number | null
): number {
  const remainingShares = plan.targetShares - plan.executedShares;
  const remainingTranches = plan.trancheCount - plan.tranchesExecuted;

  if (remainingTranches <= 0) return 0;

  const baseSize = remainingShares / remainingTranches;

  // If no current score, use base size
  if (currentScore === null) return Math.ceil(baseSize);

  // Scale by conviction: score 0.5 = 0x, score 0.75 = 0.5x, score 1.0 = 1.0x
  const convictionMultiplier = Math.max(0.2, Math.min(1.5, (currentScore - 0.5) / 0.5));

  return Math.max(1, Math.ceil(baseSize * convictionMultiplier));
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

export function computeTrancheSize(plan: StrategicPlanRow, currentScore?: number | null, trancheStyle?: string): number {
  // Use conviction-scaled if specified
  if (trancheStyle === 'conviction_scaled' && currentScore !== undefined) {
    return computeConvictionScaledTranche(plan, currentScore);
  }

  // Default: equal-weight tranches
  const remainingShares = plan.targetShares - plan.executedShares;
  const remainingTranches = plan.trancheCount - plan.tranchesExecuted;

  if (remainingTranches <= 0) return 0;

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
  const { strategicPlansRepo, planTranchesRepo, signalSnapshotsRepo, marketRegimeRepo, getSettings } = deps;
  const settings = getSettings();

  // Get current signal for conviction-scaled sizing
  const signal = signalSnapshotsRepo.getLatest(plan.symbol);
  const currentScore = signal?.compositeEwma ?? signal?.compositeScore ?? null;

  // Compute shares - use budget-aware calculation if cash provided
  let shares: number;
  if (availableCashCents !== undefined) {
    const result = computeTrancheSizeWithBudget(plan, priceCents, availableCashCents);
    if (result.shares === 0) {
      log.warn('tranche skipped', { planId: plan.id, symbol: plan.symbol, reason: result.reason });
      return null;
    }
    shares = result.shares;

    // Apply conviction scaling if enabled
    if (settings.execution.trancheStyle === 'conviction_scaled' && currentScore !== null) {
      const convictionMultiplier = Math.max(0.2, Math.min(1.5, (currentScore - 0.5) / 0.5));
      shares = Math.max(1, Math.ceil(shares * convictionMultiplier));
    }
  } else {
    shares = computeTrancheSize(plan, currentScore, settings.execution.trancheStyle);
    if (shares === 0) {
      log.warn('tranche skipped', { planId: plan.id, symbol: plan.symbol, reason: 'no shares to execute' });
      return null;
    }
  }

  const trancheNumber = plan.tranchesExecuted + 1;

  // Get current context
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

// ── Sector Exposure Check ───────────────────────────────────────────────────

// Simple sector mapping (in production, fetch from fundamentals API)
const SECTOR_MAP: Record<string, string> = {
  AAPL: 'Technology', MSFT: 'Technology', GOOGL: 'Technology', AMZN: 'Consumer Cyclical',
  META: 'Technology', NVDA: 'Technology', TSLA: 'Consumer Cyclical', AMD: 'Technology',
  JPM: 'Financial', BAC: 'Financial', GS: 'Financial', MS: 'Financial',
  JNJ: 'Healthcare', UNH: 'Healthcare', PFE: 'Healthcare', MRK: 'Healthcare',
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy',
  GLD: 'Commodities', TLT: 'Fixed Income', SHY: 'Fixed Income',
};

function getSector(symbol: string): string {
  return SECTOR_MAP[symbol.toUpperCase()] ?? 'Unknown';
}

export interface SectorExposure {
  sector: string;
  valueCents: number;
  percent: number;
}

/**
 * Calculate current sector exposure from positions.
 */
export function calculateSectorExposure(
  deps: StrategicPlanDeps
): { exposures: SectorExposure[]; totalValueCents: number } {
  const { positionsRepo, pricesRepo, portfolioRepo } = deps;

  if (!positionsRepo) {
    return { exposures: [], totalValueCents: 0 };
  }

  const portfolio = portfolioRepo.read();
  if (!portfolio) {
    return { exposures: [], totalValueCents: 0 };
  }

  const positions = positionsRepo.list();
  let totalValueCents = portfolio.cashCents;
  const sectorValues = new Map<string, number>();

  for (const pos of positions) {
    const price = pricesRepo.getLatest(pos.symbol);
    if (!price) continue;

    const valueCents = pos.qty * price.adjCloseCents;
    totalValueCents += valueCents;

    const sector = getSector(pos.symbol);
    sectorValues.set(sector, (sectorValues.get(sector) ?? 0) + valueCents);
  }

  const exposures: SectorExposure[] = [];
  for (const [sector, valueCents] of sectorValues) {
    exposures.push({
      sector,
      valueCents,
      percent: totalValueCents > 0 ? valueCents / totalValueCents : 0,
    });
  }

  return { exposures, totalValueCents };
}

/**
 * Check if executing a tranche would exceed sector exposure limit.
 */
export function checkSectorExposure(
  deps: StrategicPlanDeps,
  symbol: string,
  trancheValueCents: number
): { allowed: boolean; reason?: string; currentExposure?: number; newExposure?: number } {
  const { getSettings } = deps;
  const settings = getSettings();

  const maxSectorExposure = settings.execution.maxSectorExposure;
  if (maxSectorExposure >= 1) {
    return { allowed: true }; // No limit
  }

  const { exposures, totalValueCents } = calculateSectorExposure(deps);
  const sector = getSector(symbol);
  const currentSectorValue = exposures.find(e => e.sector === sector)?.valueCents ?? 0;
  const currentExposure = totalValueCents > 0 ? currentSectorValue / totalValueCents : 0;
  const newExposure = totalValueCents > 0 ? (currentSectorValue + trancheValueCents) / (totalValueCents + trancheValueCents) : 0;

  if (newExposure > maxSectorExposure) {
    return {
      allowed: false,
      reason: `sector ${sector} would exceed ${(maxSectorExposure * 100).toFixed(0)}% limit (${(newExposure * 100).toFixed(1)}%)`,
      currentExposure,
      newExposure,
    };
  }

  return { allowed: true, currentExposure, newExposure };
}

// ── Auto-Hedge Plan Creation ───────────────────────────────────────────────

export interface AutoHedgeResult {
  hedgePlanCreated: boolean;
  symbol?: string;
  reason?: string;
}

/**
 * Auto-create HEDGE plan when RISK_OFF regime is confirmed and cash is sufficient.
 */
export function maybeCreateAutoHedgePlan(deps: StrategicPlanDeps): AutoHedgeResult {
  const { strategicPlansRepo, marketRegimeRepo, portfolioRepo, pricesRepo, getSettings } = deps;
  const settings = getSettings();

  if (!settings.hedging.autoCreateHedgePlan) {
    return { hedgePlanCreated: false, reason: 'auto-hedge disabled' };
  }

  const regime = getCurrentRegime(marketRegimeRepo);
  if (regime !== 'RISK_OFF') {
    return { hedgePlanCreated: false, reason: 'not in RISK_OFF regime' };
  }

  const streak = marketRegimeRepo.getRegimeStreak('RISK_OFF');
  if (streak < settings.hedging.minRiskOffStreak) {
    return { hedgePlanCreated: false, reason: `RISK_OFF streak ${streak} < min ${settings.hedging.minRiskOffStreak}` };
  }

  const portfolio = portfolioRepo.read();
  if (!portfolio) {
    return { hedgePlanCreated: false, reason: 'no portfolio' };
  }

  // Calculate total portfolio value
  const { totalValueCents } = calculateSectorExposure(deps);
  const cashPercent = totalValueCents > 0 ? portfolio.cashCents / totalValueCents : 0;

  if (cashPercent < settings.hedging.minCashForHedge) {
    return { hedgePlanCreated: false, reason: `cash ${(cashPercent * 100).toFixed(1)}% < min ${(settings.hedging.minCashForHedge * 100).toFixed(0)}%` };
  }

  // Try each hedge asset in order
  for (const hedgeSymbol of settings.hedging.riskOffAssets) {
    const existingPlan = strategicPlansRepo.getActiveBySymbol(hedgeSymbol);
    if (existingPlan) continue;

    const price = pricesRepo.getLatest(hedgeSymbol);
    if (!price) continue;

    // Target 15% allocation to hedge
    const targetWeight = 0.15;
    const targetValueCents = totalValueCents * targetWeight;
    const targetShares = Math.floor(targetValueCents / price.adjCloseCents);

    if (targetShares < 1) continue;

    try {
      createPlan(deps, {
        symbol: hedgeSymbol,
        direction: 'HEDGE',
        targetShares,
        targetWeight,
        conviction: 1, // High conviction for hedge
        creationNotes: `Auto-hedge: RISK_OFF streak=${streak}, cash=${(cashPercent * 100).toFixed(1)}%`,
      });

      log.info('auto-hedge plan created', { symbol: hedgeSymbol, targetShares, streak });
      return { hedgePlanCreated: true, symbol: hedgeSymbol };
    } catch (err) {
      log.warn('failed to create hedge plan', { symbol: hedgeSymbol, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { hedgePlanCreated: false, reason: 'all hedge assets have active plans or no price' };
}
