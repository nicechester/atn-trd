/**
 * ReplayRunner: Orchestrates backtest by replaying actual production jobs.
 * 
 * Daily sequence:
 * 1. Load prices for date
 * 2. Run regime detection
 * 3. Run signal collection
 * 4. Run plan review (creates/updates plans)
 * 5. Run tranche executor (executes trades)
 * 6. Record snapshot
 */

import { randomUUID } from 'crypto';
import type { Settings } from '@atn-trd/shared';
import { BacktestState } from './BacktestState.js';
import type { IMarketRegimeRepo, ISignalSnapshotsRepo, IStrategicPlansRepo, IPlanTranchesRepo, IPortfolioRepo, IPricesRepo, IPositionsRepo, IWatchlistRepo, Regime, SignalSnapshotRow } from './repos/interfaces.js';

// ── Data Providers ────────────────────────────────────────────────────────────

export interface BacktestDataProvider {
  /** Get sentiment score for symbol as of date (point-in-time) */
  getSentiment(symbol: string, date: string): number | null;
  /** Get price for symbol on date */
  getPrice(symbol: string, date: string): { openCents: number; closeCents: number; adjCloseCents: number } | null;
  /** Get price range for SMA calculation */
  getPriceRange(symbol: string, startDate: string, endDate: string): Array<{ date: string; adjCloseCents: number }>;
  /** Get VIX value as of date (for regime detection) */
  getVix?(date: string): number | null;
  /** Get yield curve spread as of date (for regime detection) */
  getYieldCurve?(date: string): number | null;
}

// ── Replay Job Deps ───────────────────────────────────────────────────────────

export interface ReplayRegimeDeps {
  marketRegimeRepo: IMarketRegimeRepo;
  getSettings: () => Settings;
}

export interface ReplaySignalDeps {
  signalSnapshotsRepo: ISignalSnapshotsRepo;
  pricesRepo: IPricesRepo;
  watchlistRepo: IWatchlistRepo;
  positionsRepo: IPositionsRepo;
  getSettings: () => Settings;
}

export interface ReplayPlanReviewDeps {
  signalSnapshotsRepo: ISignalSnapshotsRepo;
  strategicPlansRepo: IStrategicPlansRepo;
  planTranchesRepo: IPlanTranchesRepo;
  marketRegimeRepo: IMarketRegimeRepo;
  portfolioRepo: IPortfolioRepo;
  pricesRepo: IPricesRepo;
  watchlistRepo: IWatchlistRepo;
  positionsRepo: IPositionsRepo;
  getSettings: () => Settings;
}

export interface ReplayTrancheExecutorDeps extends ReplayPlanReviewDeps {
  onFill: (symbol: string, side: 'buy' | 'sell', qty: number, priceCents: number) => void;
}

// ── Replay Logic ──────────────────────────────────────────────────────────────

/**
 * Replay regime detection for a specific date.
 */
function replayRegimeDetection(
  deps: ReplayRegimeDeps,
  date: string,
  dataProvider: BacktestDataProvider
): Regime {
  const { marketRegimeRepo, getSettings } = deps;
  const settings = getSettings();

  if (!settings.regime.enabled) {
    return 'RISK_ON';
  }

  const vix = dataProvider.getVix?.(date) ?? null;
  const yieldCurve = dataProvider.getYieldCurve?.(date) ?? null;

  // Compute risk score
  let riskScore = 0;
  if (vix !== null) {
    if (vix > settings.regime.vixExtremeThreshold) {
      riskScore += 0.50;
    } else if (vix > settings.regime.vixRiskOffThreshold) {
      riskScore += 0.30;
    }
  }
  if (yieldCurve !== null && settings.regime.yieldCurveEnabled && yieldCurve < 0) {
    riskScore += 0.25;
  }
  riskScore = Math.min(1, riskScore);

  // Determine regime
  let regime: Regime = 'RISK_ON';
  if (riskScore >= 0.50) regime = 'RISK_OFF';
  else if (riskScore >= 0.25) regime = 'NEUTRAL';

  // Store
  marketRegimeRepo.upsert({
    id: randomUUID(),
    asOfDate: date,
    regime,
    vixLevel: vix,
    yieldCurveSpread: yieldCurve,
    breadthPct: null,
    riskScore,
    indicatorsJson: JSON.stringify({ vix, yieldCurve }),
    createdAt: Date.now(),
  });

  return regime;
}

/**
 * Compute price vs 50-day SMA.
 */
function computePriceVsSma50(prices: Array<{ adjCloseCents: number }>): number | null {
  if (prices.length < 50) return null;
  const currentPrice = prices[prices.length - 1].adjCloseCents;
  const sma50 = prices.slice(-50).reduce((sum, p) => sum + p.adjCloseCents, 0) / 50;
  if (sma50 === 0) return null;
  return (currentPrice - sma50) / sma50;
}

/**
 * Compute sentiment trend from recent scores.
 */
function computeSentimentTrend(scores: number[]): number | null {
  if (scores.length < 3) return null;
  const n = scores.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += scores[i];
    sumXY += i * scores[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Compute composite score from weighted signals.
 */
function computeCompositeScore(
  sentimentScore: number | null,
  sentimentTrend: number | null,
  priceVsSma50: number | null,
  weights: { sentiment: number; sentimentTrend: number; priceMomentum: number; options: number; fundamentals: number }
): number | null {
  let score = 0;
  let totalWeight = 0;

  if (sentimentScore !== null) {
    score += weights.sentiment * sentimentScore;
    totalWeight += weights.sentiment;
  }
  if (sentimentTrend !== null) {
    const normalizedTrend = Math.max(-1, Math.min(1, sentimentTrend * 10));
    score += weights.sentimentTrend * normalizedTrend;
    totalWeight += weights.sentimentTrend;
  }
  if (priceVsSma50 !== null) {
    const normalizedMomentum = Math.max(-1, Math.min(1, priceVsSma50 * 5));
    score += weights.priceMomentum * normalizedMomentum;
    totalWeight += weights.priceMomentum;
  }
  // options and fundamentals are 0 for FNSPID backtest

  if (totalWeight <= 0) return null;
  const rawScore = score / totalWeight;
  return (rawScore + 1) / 2; // Rescale to [0, 1]
}

/**
 * Compute EWMA-smoothed composite score.
 */
function computeEwma(currentScore: number | null, previousEwma: number | null, alpha: number): number | null {
  if (currentScore === null) return previousEwma;
  if (previousEwma === null) return currentScore;
  return alpha * currentScore + (1 - alpha) * previousEwma;
}

/**
 * Replay signal collection for a specific date.
 */
function replaySignalCollection(
  deps: ReplaySignalDeps,
  date: string,
  dataProvider: BacktestDataProvider,
  priceHistory: Map<string, Array<{ date: string; adjCloseCents: number }>>
): void {
  const { signalSnapshotsRepo, watchlistRepo, positionsRepo, getSettings } = deps;
  const settings = getSettings();

  if (!settings.signals.enabled) return;

  // Get all symbols to process
  const watchlistSymbols = watchlistRepo.list().filter(w => w.enabled).map(w => w.symbol);
  const positionSymbols = positionsRepo.list().map(p => p.symbol);
  const allSymbols = [...new Set([...watchlistSymbols, ...positionSymbols])];

  for (const symbol of allSymbols) {
    // Skip if already collected
    if (signalSnapshotsRepo.get(symbol, date)) continue;

    // Get sentiment
    const sentimentScore = dataProvider.getSentiment(symbol, date);

    // Update price history
    let history = priceHistory.get(symbol);
    if (!history) {
      history = [];
      priceHistory.set(symbol, history);
    }
    const price = dataProvider.getPrice(symbol, date);
    if (price) {
      history.push({ date, adjCloseCents: price.adjCloseCents });
      if (history.length > 60) history.shift();
    }

    const priceVsSma50 = computePriceVsSma50(history);

    // Get recent sentiment for trend
    const recentSentiment = signalSnapshotsRepo.getRecentSentiment(symbol, settings.signals.rollingWindowDays);
    const sentimentScores = recentSentiment.map(s => s.sentimentScore).reverse();
    if (sentimentScore !== null) sentimentScores.push(sentimentScore);
    const sentimentTrend = computeSentimentTrend(sentimentScores);

    // Compute composite (options/fundamentals = 0 for FNSPID)
    const compositeScore = computeCompositeScore(
      sentimentScore,
      sentimentTrend,
      priceVsSma50,
      settings.signals.weights
    );

    // Compute EWMA
    const previousSnapshot = signalSnapshotsRepo.getLatest(symbol);
    const compositeEwma = computeEwma(
      compositeScore,
      previousSnapshot?.compositeEwma ?? null,
      settings.signals.ewmaAlpha
    );

    // Store snapshot
    const snapshot: SignalSnapshotRow = {
      id: randomUUID(),
      symbol,
      snapshotDate: date,
      priceCents: price?.adjCloseCents ?? null,
      sentimentScore,
      sentimentConfidence: null,
      sentimentTrend,
      priceVsSma50,
      ivPercentile: null,
      putCallRatio: null,
      valuationScore: null,
      growthScore: null,
      compositeScore,
      compositeEwma,
      sentimentSynthesis: null,
      createdAt: Date.now(),
    };

    signalSnapshotsRepo.insert(snapshot);
  }
}

/**
 * Replay plan review for a specific date.
 * Creates ACCUMULATE plans for high-scoring watchlist symbols.
 * Creates TRIM plans for low-scoring positions.
 */
function replayPlanReview(deps: ReplayPlanReviewDeps, currentDate: string): {
  plansCreated: number;
  trimPlansCreated: number;
} {
  const {
    signalSnapshotsRepo, strategicPlansRepo,
    marketRegimeRepo, portfolioRepo, pricesRepo, watchlistRepo, positionsRepo, getSettings
  } = deps;
  // Note: planTranchesRepo available in deps but not used in plan review (only in tranche executor)
  const settings = getSettings();

  let plansCreated = 0;
  let trimPlansCreated = 0;

  if (!settings.execution.enabled) return { plansCreated, trimPlansCreated };

  // Check regime
  const regime = marketRegimeRepo.getLatest()?.regime ?? 'RISK_ON';
  if (regime === 'RISK_OFF' && settings.execution.requireRegimeCheck) {
    return { plansCreated, trimPlansCreated };
  }

  const portfolio = portfolioRepo.read();
  if (!portfolio) return { plansCreated, trimPlansCreated };

  const watchlist = watchlistRepo.list().filter(w => w.enabled);
  const positions = positionsRepo.list();

  // --- ACCUMULATE plans from watchlist ---
  for (const item of watchlist) {
    const existingPlan = strategicPlansRepo.getActiveBySymbol(item.symbol);
    if (existingPlan) continue;

    const signal = signalSnapshotsRepo.getLatest(item.symbol);
    if (!signal) continue;

    const score = signal.compositeEwma ?? signal.compositeScore;
    if (score === null || score < settings.signals.buyThreshold) continue;

    const price = pricesRepo.getLatest(item.symbol);
    if (!price) continue;

    const conviction = Math.min(1, (score - settings.signals.buyThreshold) / (1 - settings.signals.buyThreshold));
    const baseWeight = 0.05;
    const convictionMultiplier = 0.5 + conviction;
    const targetWeight = Math.min(baseWeight * convictionMultiplier, settings.risk.maxPositionWeightPercent / 100);
    const targetValueCents = portfolio.cashCents * targetWeight;
    const targetShares = Math.floor(targetValueCents / price.adjCloseCents);

    if (targetShares < 1) continue;

    strategicPlansRepo.create({
      id: randomUUID(),
      symbol: item.symbol,
      direction: 'ACCUMULATE',
      targetShares,
      targetWeight,
      targetBudgetCents: null,
      trancheCount: settings.execution.defaultTrancheCount,
      minDaysBetween: settings.execution.minDaysBetweenTranches,
      entryCompositeScore: score,
      convictionAtCreation: conviction,
      status: 'ACTIVE',
      pauseReason: null,
      creationNotes: `Backtest: score=${score.toFixed(2)}, date=${currentDate}`,
      createdAt: Date.now(),
    });

    plansCreated++;
  }

  // --- TRIM plans from positions with bearish signals ---
  for (const position of positions) {
    const existingPlan = strategicPlansRepo.getActiveBySymbol(position.symbol);
    if (existingPlan) continue;

    const signal = signalSnapshotsRepo.getLatest(position.symbol);
    if (!signal) continue;

    const score = signal.compositeEwma ?? signal.compositeScore;
    if (score === null || score > settings.signals.sellThreshold) continue;

    const conviction = Math.min(1, (settings.signals.sellThreshold - score) / settings.signals.sellThreshold);

    strategicPlansRepo.create({
      id: randomUUID(),
      symbol: position.symbol,
      direction: 'TRIM',
      targetShares: position.qty,
      targetWeight: null,
      targetBudgetCents: null,
      trancheCount: settings.execution.defaultTrancheCount,
      minDaysBetween: settings.execution.minDaysBetweenTranches,
      entryCompositeScore: score,
      convictionAtCreation: conviction,
      status: 'ACTIVE',
      pauseReason: null,
      creationNotes: `Backtest TRIM: score=${score.toFixed(2)}, date=${currentDate}`,
      createdAt: Date.now(),
    });

    trimPlansCreated++;
  }

  return { plansCreated, trimPlansCreated };
}

/**
 * Replay tranche executor for a specific date.
 * Executes tranches for active plans.
 */
function replayTrancheExecutor(deps: ReplayTrancheExecutorDeps, _date: string): {
  tranchesExecuted: number;
  plansPaused: number;
  plansCancelled: number;
} {
  const {
    signalSnapshotsRepo, strategicPlansRepo, planTranchesRepo,
    marketRegimeRepo, portfolioRepo, pricesRepo, positionsRepo, getSettings, onFill
  } = deps;
  const settings = getSettings();

  let tranchesExecuted = 0;
  let plansPaused = 0;
  let plansCancelled = 0;

  if (!settings.execution.enabled) return { tranchesExecuted, plansPaused, plansCancelled };

  // Check regime and pause/resume plans
  const regime = marketRegimeRepo.getLatest()?.regime ?? 'RISK_ON';
  if (regime === 'RISK_OFF' && settings.execution.requireRegimeCheck) {
    const streak = marketRegimeRepo.getRegimeStreak('RISK_OFF');
    if (streak >= settings.regime.confirmationDays) {
      for (const plan of strategicPlansRepo.listActive()) {
        if (plan.direction === 'ACCUMULATE') {
          strategicPlansRepo.updateStatus(plan.id, 'PAUSED', 'regime_risk_off');
          plansPaused++;
        }
      }
    }
  } else {
    // Resume paused plans
    for (const plan of strategicPlansRepo.listPaused()) {
      if (plan.pauseReason === 'regime_risk_off') {
        strategicPlansRepo.updateStatus(plan.id, 'ACTIVE');
      }
    }
  }

  // Execute tranches for active plans
  const activePlans = strategicPlansRepo.listActive();
  const portfolio = portfolioRepo.read();

  for (const plan of activePlans) {
    // Check minimum days between tranches
    if (plan.lastTrancheAt) {
      const daysSince = Math.floor((Date.now() - plan.lastTrancheAt) / 86_400_000);
      if (daysSince < plan.minDaysBetween) continue;
    }

    // Check if all tranches executed
    if (plan.tranchesExecuted >= plan.trancheCount) continue;

    // Check signal for ACCUMULATE plans
    if (plan.direction === 'ACCUMULATE') {
      const signal = signalSnapshotsRepo.getLatest(plan.symbol);
      const score = signal?.compositeEwma ?? signal?.compositeScore;
      if (score !== null && score !== undefined) {
        if (score < settings.signals.cancelThreshold) {
          strategicPlansRepo.updateStatus(plan.id, 'CANCELLED', `signal_below_threshold:${score.toFixed(2)}`);
          plansCancelled++;
          continue;
        }
        if (score < settings.signals.pauseThreshold) {
          continue; // Skip this tranche but don't cancel
        }
      }
    }

    // Get price
    const price = pricesRepo.getLatest(plan.symbol);
    if (!price) continue;

    // Compute tranche size
    const remainingShares = plan.targetShares - plan.executedShares;
    const remainingTranches = plan.trancheCount - plan.tranchesExecuted;
    if (remainingTranches <= 0) continue;

    let shares = Math.ceil(remainingShares / remainingTranches);

    // For buys, check cash
    if (plan.direction === 'ACCUMULATE' && portfolio) {
      const maxAffordable = Math.floor(portfolio.cashCents / price.adjCloseCents);
      shares = Math.min(shares, maxAffordable);
    }

    if (shares < 1) continue;

    // For sells, check position
    if (plan.direction === 'TRIM') {
      const position = positionsRepo.get(plan.symbol);
      if (!position || position.qty < shares) {
        shares = position?.qty ?? 0;
      }
    }

    if (shares < 1) continue;

    // Execute fill
    const side = plan.direction === 'ACCUMULATE' ? 'buy' : 'sell';
    onFill(plan.symbol, side, shares, price.adjCloseCents);

    // Record tranche
    const trancheNumber = plan.tranchesExecuted + 1;
    planTranchesRepo.create({
      id: randomUUID(),
      planId: plan.id,
      trancheNumber,
      shares,
      priceCents: price.adjCloseCents,
      orderId: null,
      compositeScore: signalSnapshotsRepo.getLatest(plan.symbol)?.compositeEwma ?? null,
      regime,
      executedAt: Date.now(),
    });
    planTranchesRepo.updateStatus(
      Array.from({ length: 1 }).map(() => randomUUID())[0], // dummy, we just created it
      'FILLED',
      shares * price.adjCloseCents,
      Date.now()
    );

    strategicPlansRepo.recordTrancheExecution(plan.id, shares);
    tranchesExecuted++;

    // Check if plan is complete
    const updatedPlan = strategicPlansRepo.get(plan.id);
    if (updatedPlan && updatedPlan.tranchesExecuted >= updatedPlan.trancheCount) {
      strategicPlansRepo.updateStatus(plan.id, 'COMPLETED');
    }
  }

  return { tranchesExecuted, plansPaused, plansCancelled };
}

// ── Main Replay Runner ────────────────────────────────────────────────────────

export interface ReplayRunnerConfig {
  startDate: string;
  endDate: string;
  symbols: string[];
  startingCashCents: number;
  settings: Settings;
  dataProvider: BacktestDataProvider;
  onDayComplete?: (date: string, snapshot: ReturnType<BacktestState['getStateSnapshot']>) => void;
}

export interface ReplayResult {
  finalState: ReturnType<BacktestState['getStateSnapshot']>;
  totalTrades: number;
  plansCreated: number;
  trimPlansCreated: number;
}

/**
 * Run a full backtest replay using actual production job logic.
 */
export async function runReplay(config: ReplayRunnerConfig): Promise<ReplayResult> {
  const { startDate, endDate, symbols, startingCashCents, settings, dataProvider, onDayComplete } = config;

  // Initialize state
  const state = new BacktestState({ symbols, startingCashCents, startDate });

  // Pre-load price history for SMA calculation
  const priceHistory = new Map<string, Array<{ date: string; adjCloseCents: number }>>();
  const preloadStart = new Date(startDate);
  preloadStart.setDate(preloadStart.getDate() - 70);
  const preloadStartStr = preloadStart.toISOString().split('T')[0];

  for (const symbol of symbols) {
    const prices = dataProvider.getPriceRange(symbol, preloadStartStr, startDate);
    if (prices.length > 0) {
      priceHistory.set(symbol, prices.map(p => ({ date: p.date, adjCloseCents: p.adjCloseCents })));
    }
  }

  // Load initial prices into state
  for (const symbol of symbols) {
    const price = dataProvider.getPrice(symbol, startDate);
    if (price) {
      state.prices.upsert({
        symbol,
        barDate: startDate,
        openCents: price.openCents,
        highCents: price.closeCents,
        lowCents: price.closeCents,
        closeCents: price.closeCents,
        adjCloseCents: price.adjCloseCents,
        volume: null,
        provider: 'backtest',
        fetchedAt: Date.now(),
      });
    }
  }

  const getSettings = () => settings;
  let totalTrades = 0;
  let totalPlansCreated = 0;
  let totalTrimPlansCreated = 0;

  // Iterate through trading days
  let currentDate = startDate;
  while (currentDate <= endDate) {
    state.setCurrentDate(currentDate);

    // Load prices for this date
    for (const symbol of symbols) {
      const price = dataProvider.getPrice(symbol, currentDate);
      if (price) {
        state.prices.upsert({
          symbol,
          barDate: currentDate,
          openCents: price.openCents,
          highCents: price.closeCents,
          lowCents: price.closeCents,
          closeCents: price.closeCents,
          adjCloseCents: price.adjCloseCents,
          volume: null,
          provider: 'backtest',
          fetchedAt: Date.now(),
        });
      }
    }

    // 1. Regime detection
    replayRegimeDetection(
      { marketRegimeRepo: state.marketRegime, getSettings },
      currentDate,
      dataProvider
    );

    // 2. Signal collection
    replaySignalCollection(
      {
        signalSnapshotsRepo: state.signalSnapshots,
        pricesRepo: state.prices,
        watchlistRepo: state.watchlist,
        positionsRepo: state.positions,
        getSettings,
      },
      currentDate,
      dataProvider,
      priceHistory
    );

    // 3. Plan review
    const planResult = replayPlanReview(
      {
        signalSnapshotsRepo: state.signalSnapshots,
        strategicPlansRepo: state.strategicPlans,
        planTranchesRepo: state.planTranches,
        marketRegimeRepo: state.marketRegime,
        portfolioRepo: state.portfolio,
        pricesRepo: state.prices,
        watchlistRepo: state.watchlist,
        positionsRepo: state.positions,
        getSettings,
      },
      currentDate
    );
    totalPlansCreated += planResult.plansCreated;
    totalTrimPlansCreated += planResult.trimPlansCreated;

    // 4. Tranche executor
    replayTrancheExecutor(
      {
        signalSnapshotsRepo: state.signalSnapshots,
        strategicPlansRepo: state.strategicPlans,
        planTranchesRepo: state.planTranches,
        marketRegimeRepo: state.marketRegime,
        portfolioRepo: state.portfolio,
        pricesRepo: state.prices,
        watchlistRepo: state.watchlist,
        positionsRepo: state.positions,
        getSettings,
        onFill: (symbol, side, qty, priceCents) => {
          state.recordFill(symbol, side, qty, priceCents);
          totalTrades++;
        },
      },
      currentDate
    );

    // Callback for progress tracking
    if (onDayComplete) {
      onDayComplete(currentDate, state.getStateSnapshot());
    }

    // Next trading day (simple increment, caller should filter non-trading days)
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    currentDate = nextDate.toISOString().split('T')[0];
  }

  return {
    finalState: state.getStateSnapshot(),
    totalTrades,
    plansCreated: totalPlansCreated,
    trimPlansCreated: totalTrimPlansCreated,
  };
}
