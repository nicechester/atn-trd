import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { StrategicPlansRepo } from '../repos/strategicPlansRepo.js';
import { PlanTranchesRepo } from '../repos/planTranchesRepo.js';
import { SignalSnapshotsRepo } from '../repos/signalSnapshotsRepo.js';
import { MarketRegimeRepo } from '../repos/marketRegimeRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import {
  createPlan,
  pausePlan,
  shouldExecuteTranche,
  computeTrancheSizeWithBudget,
  executeTranche,
  checkAndPausePlansForRegime,
  checkAndResumePlansForRegime,
  createAutoTrimPlans,
  type StrategicPlanDeps,
} from './strategicPlanService.js';
import { DEFAULT_SETTINGS, type Settings } from '@atn-trd/shared';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../db/migrations');

function createDeps(db: Database.Database, settingsOverride?: Partial<Settings>): StrategicPlanDeps {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...settingsOverride };
  return {
    strategicPlansRepo: new StrategicPlansRepo(db),
    planTranchesRepo: new PlanTranchesRepo(db),
    signalSnapshotsRepo: new SignalSnapshotsRepo(db),
    marketRegimeRepo: new MarketRegimeRepo(db),
    portfolioRepo: new PortfolioRepo(db),
    pricesRepo: new PricesRepo(db),
    positionsRepo: new PositionsRepo(db),
    getSettings: () => settings,
  };
}

describe('StrategicPlanService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);
  });

  describe('createPlan', () => {
    it('creates plan with targetShares', () => {
      const deps = createDeps(db);
      const plan = createPlan(deps, {
        symbol: 'AAPL',
        direction: 'ACCUMULATE',
        targetShares: 100,
        conviction: 0.8,
      });

      assert.equal(plan.symbol, 'AAPL');
      assert.equal(plan.direction, 'ACCUMULATE');
      assert.equal(plan.targetShares, 100);
      assert.equal(plan.targetBudgetCents, null);
      assert.equal(plan.status, 'ACTIVE');
    });

    it('creates plan with targetBudgetCents for chunky stocks', () => {
      const deps = createDeps(db);
      const plan = createPlan(deps, {
        symbol: 'BRK.A',
        direction: 'ACCUMULATE',
        targetBudgetCents: 5000000, // $50,000 budget
        conviction: 0.9,
      });

      assert.equal(plan.symbol, 'BRK.A');
      assert.equal(plan.targetShares, 0);
      assert.equal(plan.targetBudgetCents, 5000000);
    });

    it('throws if neither targetShares nor targetBudgetCents provided', () => {
      const deps = createDeps(db);
      assert.throws(() => {
        createPlan(deps, {
          symbol: 'AAPL',
          direction: 'ACCUMULATE',
        });
      }, /Either targetShares or targetBudgetCents must be provided/);
    });

    it('throws if active plan already exists for symbol', () => {
      const deps = createDeps(db);
      createPlan(deps, { symbol: 'AAPL', direction: 'ACCUMULATE', targetShares: 100 });

      assert.throws(() => {
        createPlan(deps, { symbol: 'AAPL', direction: 'ACCUMULATE', targetShares: 50 });
      }, /Active plan already exists/);
    });

    it('allows new plan after previous is completed', () => {
      const deps = createDeps(db);
      const plan1 = createPlan(deps, { symbol: 'AAPL', direction: 'ACCUMULATE', targetShares: 100 });
      deps.strategicPlansRepo.updateStatus(plan1.id, 'COMPLETED');

      const plan2 = createPlan(deps, { symbol: 'AAPL', direction: 'ACCUMULATE', targetShares: 50 });
      assert.equal(plan2.status, 'ACTIVE');
    });
  });

  describe('computeTrancheSizeWithBudget - Chunky Stock Handling', () => {
    it('computes shares from budget for expensive stocks', () => {
      const deps = createDeps(db);
      const plan = createPlan(deps, {
        symbol: 'GOOG',
        direction: 'ACCUMULATE',
        targetBudgetCents: 4000000, // $40,000
        trancheCount: 4,
      });

      // $150/share, $100,000 available
      const result = computeTrancheSizeWithBudget(plan, 15000, 10000000);

      // Tranche budget = $40,000 / 4 = $10,000
      // Shares = $10,000 / $150 = 66
      assert.equal(result.shares, 66);
      assert.equal(result.reason, undefined);
    });

    it('returns 0 shares when cannot afford 1 share', () => {
      const deps = createDeps(db);
      const plan = createPlan(deps, {
        symbol: 'BRK.A',
        direction: 'ACCUMULATE',
        targetBudgetCents: 100000, // $1,000
        trancheCount: 4,
      });

      // $600,000/share, only $500 available
      const result = computeTrancheSizeWithBudget(plan, 60000000, 50000);

      assert.equal(result.shares, 0);
      assert.equal(result.reason, 'insufficient cash for 1 whole share');
    });

    it('limits shares to available cash', () => {
      const deps = createDeps(db);
      const plan = createPlan(deps, {
        symbol: 'AAPL',
        direction: 'ACCUMULATE',
        targetBudgetCents: 1000000, // $10,000
        trancheCount: 4,
      });

      // $150/share, only $200 available (can afford 1 share)
      const result = computeTrancheSizeWithBudget(plan, 15000, 20000);

      assert.equal(result.shares, 1);
    });
  });

  describe('shouldExecuteTranche - Hysteresis', () => {
    it('allows execution when score above pause threshold', () => {
      const deps = createDeps(db, {
        signals: { ...DEFAULT_SETTINGS.signals, pauseThreshold: 0.60, cancelThreshold: 0.45 },
      });

      const plan = createPlan(deps, { symbol: 'AAPL', direction: 'ACCUMULATE', targetShares: 100 });

      // Add signal with score above pause threshold
      deps.signalSnapshotsRepo.upsert({
        id: 'sig1',
        symbol: 'AAPL',
        snapshotDate: new Date().toISOString().split('T')[0],
        priceCents: 15000,
        sentimentScore: 0.7,
        sentimentConfidence: 0.8,
        sentimentTrend: 0.1,
        priceVsSma50: 0.05,
        compositeScore: 0.70,
        compositeEwma: 0.70,
        createdAt: Date.now(),
      });

      const result = shouldExecuteTranche(deps, plan);
      assert.equal(result.execute, true);
    });

    it('blocks execution when score below pause threshold', () => {
      const deps = createDeps(db, {
        signals: { ...DEFAULT_SETTINGS.signals, pauseThreshold: 0.60, cancelThreshold: 0.45 },
      });

      const plan = createPlan(deps, { symbol: 'AAPL', direction: 'ACCUMULATE', targetShares: 100 });

      // Add signal with score below pause threshold but above cancel
      deps.signalSnapshotsRepo.upsert({
        id: 'sig1',
        symbol: 'AAPL',
        snapshotDate: new Date().toISOString().split('T')[0],
        priceCents: 15000,
        sentimentScore: 0.5,
        sentimentConfidence: 0.8,
        sentimentTrend: -0.1,
        priceVsSma50: -0.05,
        compositeScore: 0.55,
        compositeEwma: 0.55,
        createdAt: Date.now(),
      });

      const result = shouldExecuteTranche(deps, plan);
      assert.equal(result.execute, false);
      assert.ok(result.reason?.includes('pause threshold'));
    });

    it('indicates cancel when score below cancel threshold', () => {
      const deps = createDeps(db, {
        signals: { ...DEFAULT_SETTINGS.signals, pauseThreshold: 0.60, cancelThreshold: 0.45 },
      });

      const plan = createPlan(deps, { symbol: 'AAPL', direction: 'ACCUMULATE', targetShares: 100 });

      // Add signal with score below cancel threshold
      deps.signalSnapshotsRepo.upsert({
        id: 'sig1',
        symbol: 'AAPL',
        snapshotDate: new Date().toISOString().split('T')[0],
        priceCents: 15000,
        sentimentScore: 0.3,
        sentimentConfidence: 0.8,
        sentimentTrend: -0.2,
        priceVsSma50: -0.1,
        compositeScore: 0.40,
        compositeEwma: 0.40,
        createdAt: Date.now(),
      });

      const result = shouldExecuteTranche(deps, plan);
      assert.equal(result.execute, false);
      assert.ok(result.reason?.includes('cancel threshold'));
    });
  });

  describe('executeTranche', () => {
    it('executes tranche and updates plan', () => {
      const deps = createDeps(db);
      const plan = createPlan(deps, { symbol: 'AAPL', direction: 'ACCUMULATE', targetShares: 40 });

      // Use budget-aware execution with enough cash
      const result = executeTranche(deps, plan, 15000, 1000000);

      assert.ok(result);
      assert.equal(result.symbol, 'AAPL');
      // With budget-aware: trancheBudget = (40/4)*15000 = 150000, shares = 150000/15000 = 10
      // But limited by available cash: 1000000/15000 = 66 max
      // So we get min(10, 66) = 10
      assert.equal(result.shares, 10);
      assert.equal(result.trancheNumber, 1);

      const updated = deps.strategicPlansRepo.get(plan.id);
      assert.equal(updated?.executedShares, 10);
      assert.equal(updated?.tranchesExecuted, 1);
    });

    it('returns null when insufficient cash for chunky stock', () => {
      const deps = createDeps(db);
      const plan = createPlan(deps, {
        symbol: 'BRK.A',
        direction: 'ACCUMULATE',
        targetBudgetCents: 1000000,
      });

      // Price is $600,000, only $500 available
      const result = executeTranche(deps, plan, 60000000, 50000);

      assert.equal(result, null);
    });

    it('completes plan after all tranches executed', () => {
      const deps = createDeps(db);
      const plan = createPlan(deps, {
        symbol: 'AAPL',
        direction: 'ACCUMULATE',
        targetShares: 4,
        trancheCount: 4,
      });

      for (let i = 0; i < 4; i++) {
        const currentPlan = deps.strategicPlansRepo.get(plan.id)!;
        executeTranche(deps, currentPlan, 15000, 1000000);
      }

      const final = deps.strategicPlansRepo.get(plan.id);
      assert.equal(final?.status, 'COMPLETED');
      assert.equal(final?.tranchesExecuted, 4);
    });
  });

  describe('Regime-Based Plan Management', () => {
    it('pauses ACCUMULATE plans on confirmed RISK_OFF', () => {
      const deps = createDeps(db, {
        execution: { ...DEFAULT_SETTINGS.execution, requireRegimeCheck: true },
        regime: { ...DEFAULT_SETTINGS.regime, confirmationDays: 2 },
      });

      createPlan(deps, { symbol: 'AAPL', direction: 'ACCUMULATE', targetShares: 100 });
      createPlan(deps, { symbol: 'GOOG', direction: 'ACCUMULATE', targetShares: 50 });

      // Add 2 days of RISK_OFF regime
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      deps.marketRegimeRepo.upsert({
        id: 'r1', asOfDate: yesterday, regime: 'RISK_OFF',
        vixLevel: 30, yieldCurveSpread: -0.5, breadthPct: 0.3,
        riskScore: 0.6, indicatorsJson: null, createdAt: Date.now() - 86400000,
      });
      deps.marketRegimeRepo.upsert({
        id: 'r2', asOfDate: today, regime: 'RISK_OFF',
        vixLevel: 32, yieldCurveSpread: -0.6, breadthPct: 0.28,
        riskScore: 0.65, indicatorsJson: null, createdAt: Date.now(),
      });

      const paused = checkAndPausePlansForRegime(deps);

      assert.equal(paused, 2);
      const plans = deps.strategicPlansRepo.listPaused();
      assert.equal(plans.length, 2);
      assert.equal(plans[0].pauseReason, 'regime_risk_off');
    });

    it('resumes plans when regime changes from RISK_OFF', () => {
      const deps = createDeps(db);

      const plan = createPlan(deps, { symbol: 'AAPL', direction: 'ACCUMULATE', targetShares: 100 });
      pausePlan(deps, plan.id, 'regime_risk_off');

      // Add RISK_ON regime
      deps.marketRegimeRepo.upsert({
        id: 'r1', asOfDate: new Date().toISOString().split('T')[0], regime: 'RISK_ON',
        vixLevel: 15, yieldCurveSpread: 0.5, breadthPct: 0.6,
        riskScore: 0.1, indicatorsJson: null, createdAt: Date.now(),
      });

      const resumed = checkAndResumePlansForRegime(deps);

      assert.equal(resumed, 1);
      const updated = deps.strategicPlansRepo.get(plan.id);
      assert.equal(updated?.status, 'ACTIVE');
    });
  });

  describe('Auto-Trim for Hedging', () => {
    it('creates TRIM plans for low-conviction positions', () => {
      const deps = createDeps(db, {
        hedging: { ...DEFAULT_SETTINGS.hedging, autoTrimForCash: true, cashReserveInRiskOff: 0.40 },
      });

      // Initialize portfolio with low cash
      deps.portfolioRepo.write({
        cashCents: 100000, // $1,000 (10% of $10,000 portfolio)
        startingCashCents: 1000000,
        startedAt: Date.now(),
        resetAt: null,
        baseCurrency: 'USD',
      });

      // Add positions
      deps.positionsRepo!.upsert({
        symbol: 'AAPL', qty: 10, avgCostCents: 15000,
        realizedPnlCents: 0, openedAt: Date.now(), updatedAt: Date.now(),
      });
      deps.positionsRepo!.upsert({
        symbol: 'TSLA', qty: 5, avgCostCents: 20000,
        realizedPnlCents: 0, openedAt: Date.now(), updatedAt: Date.now(),
      });

      // Add prices
      deps.pricesRepo.upsert({
        symbol: 'AAPL', barDate: new Date().toISOString().split('T')[0],
        openCents: 15000, highCents: 15500, lowCents: 14500,
        closeCents: 15000, adjCloseCents: 15000, volume: 1000000,
        provider: 'test', fetchedAt: Date.now(),
      });
      deps.pricesRepo.upsert({
        symbol: 'TSLA', barDate: new Date().toISOString().split('T')[0],
        openCents: 20000, highCents: 21000, lowCents: 19000,
        closeCents: 20000, adjCloseCents: 20000, volume: 500000,
        provider: 'test', fetchedAt: Date.now(),
      });

      // Add signals (TSLA has lower score)
      deps.signalSnapshotsRepo.upsert({
        id: 's1', symbol: 'AAPL', snapshotDate: new Date().toISOString().split('T')[0],
        priceCents: 15000, sentimentScore: 0.7, sentimentConfidence: 0.8,
        sentimentTrend: 0.1, priceVsSma50: 0.05, compositeScore: 0.70, compositeEwma: 0.70,
        createdAt: Date.now(),
      });
      deps.signalSnapshotsRepo.upsert({
        id: 's2', symbol: 'TSLA', snapshotDate: new Date().toISOString().split('T')[0],
        priceCents: 20000, sentimentScore: 0.3, sentimentConfidence: 0.6,
        sentimentTrend: -0.1, priceVsSma50: -0.05, compositeScore: 0.30, compositeEwma: 0.30,
        createdAt: Date.now(),
      });

      const result = createAutoTrimPlans(deps);

      assert.ok(result.trimPlansCreated > 0);
      assert.ok(result.symbols.includes('TSLA')); // Lower conviction trimmed first
    });

    it('skips auto-trim when disabled', () => {
      const deps = createDeps(db, {
        hedging: { ...DEFAULT_SETTINGS.hedging, autoTrimForCash: false },
      });

      const result = createAutoTrimPlans(deps);

      assert.equal(result.trimPlansCreated, 0);
    });

    it('skips auto-trim when cash already at target', () => {
      const deps = createDeps(db, {
        hedging: { ...DEFAULT_SETTINGS.hedging, autoTrimForCash: true, cashReserveInRiskOff: 0.40 },
      });

      // Initialize portfolio with sufficient cash (50%)
      deps.portfolioRepo.write({
        cashCents: 500000,
        startingCashCents: 1000000,
        startedAt: Date.now(),
        resetAt: null,
        baseCurrency: 'USD',
      });

      // Add small position
      deps.positionsRepo!.upsert({
        symbol: 'AAPL', qty: 10, avgCostCents: 15000,
        realizedPnlCents: 0, openedAt: Date.now(), updatedAt: Date.now(),
      });
      deps.pricesRepo.upsert({
        symbol: 'AAPL', barDate: new Date().toISOString().split('T')[0],
        openCents: 15000, highCents: 15500, lowCents: 14500,
        closeCents: 15000, adjCloseCents: 15000, volume: 1000000,
        provider: 'test', fetchedAt: Date.now(),
      });

      const result = createAutoTrimPlans(deps);

      assert.equal(result.trimPlansCreated, 0);
      assert.ok(result.currentCashPercent >= result.targetCashPercent);
    });
  });
});
