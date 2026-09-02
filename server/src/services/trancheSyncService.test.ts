import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { StrategicPlansRepo } from '../repos/strategicPlansRepo.js';
import { PlanTranchesRepo } from '../repos/planTranchesRepo.js';
import { OrdersRepo } from '../repos/ordersRepo.js';
import {
  syncTrancheStatus,
  syncAllPendingTranches,
  createFollowUpTranche,
  type TrancheSyncDeps,
} from './trancheSyncService.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../db/migrations');

function createDeps(db: Database.Database): TrancheSyncDeps {
  return {
    planTranchesRepo: new PlanTranchesRepo(db),
    strategicPlansRepo: new StrategicPlansRepo(db),
    ordersRepo: new OrdersRepo(db),
  };
}

describe('TrancheSyncService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);
  });

  describe('syncTrancheStatus', () => {
    it('marks tranche as FILLED when order is filled', () => {
      const deps = createDeps(db);

      // Create plan
      deps.strategicPlansRepo.create({
        id: 'plan1', symbol: 'AAPL', direction: 'ACCUMULATE',
        targetShares: 100, targetWeight: null, targetBudgetCents: null,
        trancheCount: 4, minDaysBetween: 5,
        entryCompositeScore: 0.75, convictionAtCreation: 0.8,
        status: 'ACTIVE', pauseReason: null, createdAt: Date.now(),
      });

      // Create order
      const orderId = deps.ordersRepo.create({
        clientOrderId: 'co1', decisionId: null, runId: null,
        broker: 'paper', brokerOrderId: null, mode: 'paper',
        symbol: 'AAPL', side: 'buy', qty: 25, type: 'market',
        limitPriceCents: null, tif: 'day', status: 'filled',
        rejectReason: null, submittedAt: Date.now(),
      });

      // Create pending tranche
      deps.planTranchesRepo.create({
        id: 't1', planId: 'plan1', trancheNumber: 1,
        shares: 25, priceCents: 15000, orderId,
        compositeScore: 0.75, regime: 'RISK_ON', executedAt: Date.now(),
      });

      const tranche = deps.planTranchesRepo.listByPlan('plan1')[0];
      const result = syncTrancheStatus(deps, tranche);

      assert.ok(result);
      assert.equal(result.newStatus, 'FILLED');
      assert.equal(result.previousStatus, 'PENDING');

      const updated = deps.planTranchesRepo.listByPlan('plan1')[0];
      assert.equal(updated.orderStatus, 'FILLED');
      assert.ok(updated.filledAt);
    });

    it('marks tranche as FAILED when order is rejected', () => {
      const deps = createDeps(db);

      deps.strategicPlansRepo.create({
        id: 'plan1', symbol: 'AAPL', direction: 'ACCUMULATE',
        targetShares: 100, targetWeight: null, targetBudgetCents: null,
        trancheCount: 4, minDaysBetween: 5,
        entryCompositeScore: 0.75, convictionAtCreation: 0.8,
        status: 'ACTIVE', pauseReason: null, createdAt: Date.now(),
      });

      const orderId = deps.ordersRepo.create({
        clientOrderId: 'co1', decisionId: null, runId: null,
        broker: 'paper', brokerOrderId: null, mode: 'paper',
        symbol: 'AAPL', side: 'buy', qty: 25, type: 'market',
        limitPriceCents: null, tif: 'day', status: 'rejected',
        rejectReason: 'Insufficient funds', submittedAt: Date.now(),
      });

      deps.planTranchesRepo.create({
        id: 't1', planId: 'plan1', trancheNumber: 1,
        shares: 25, priceCents: 15000, orderId,
        compositeScore: 0.75, regime: 'RISK_ON', executedAt: Date.now(),
      });

      const tranche = deps.planTranchesRepo.listByPlan('plan1')[0];
      const result = syncTrancheStatus(deps, tranche);

      assert.ok(result);
      assert.equal(result.newStatus, 'FAILED');

      const updated = deps.planTranchesRepo.listByPlan('plan1')[0];
      assert.equal(updated.orderStatus, 'FAILED');
    });

    it('marks paper tranche as FILLED when no orderId', () => {
      const deps = createDeps(db);

      deps.strategicPlansRepo.create({
        id: 'plan1', symbol: 'AAPL', direction: 'ACCUMULATE',
        targetShares: 100, targetWeight: null, targetBudgetCents: null,
        trancheCount: 4, minDaysBetween: 5,
        entryCompositeScore: 0.75, convictionAtCreation: 0.8,
        status: 'ACTIVE', pauseReason: null, createdAt: Date.now(),
      });

      // Create tranche without order (paper trading)
      deps.planTranchesRepo.create({
        id: 't1', planId: 'plan1', trancheNumber: 1,
        shares: 25, priceCents: 15000, orderId: null,
        compositeScore: 0.75, regime: 'RISK_ON', executedAt: Date.now(),
      });

      const tranche = deps.planTranchesRepo.listByPlan('plan1')[0];
      const result = syncTrancheStatus(deps, tranche);

      assert.ok(result);
      assert.equal(result.newStatus, 'FILLED');
      assert.equal(result.filledShares, 25);
    });
  });

  describe('syncAllPendingTranches', () => {
    it('syncs multiple pending tranches', () => {
      const deps = createDeps(db);

      deps.strategicPlansRepo.create({
        id: 'plan1', symbol: 'AAPL', direction: 'ACCUMULATE',
        targetShares: 100, targetWeight: null, targetBudgetCents: null,
        trancheCount: 4, minDaysBetween: 5,
        entryCompositeScore: 0.75, convictionAtCreation: 0.8,
        status: 'ACTIVE', pauseReason: null, createdAt: Date.now(),
      });

      // Create multiple pending tranches (paper mode, no orders)
      deps.planTranchesRepo.create({
        id: 't1', planId: 'plan1', trancheNumber: 1,
        shares: 25, priceCents: 15000, orderId: null,
        compositeScore: 0.75, regime: 'RISK_ON', executedAt: Date.now(),
      });
      deps.planTranchesRepo.create({
        id: 't2', planId: 'plan1', trancheNumber: 2,
        shares: 25, priceCents: 15500, orderId: null,
        compositeScore: 0.72, regime: 'RISK_ON', executedAt: Date.now(),
      });

      const results = syncAllPendingTranches(deps);

      assert.equal(results.length, 2);
      assert.ok(results.every(r => r.newStatus === 'FILLED'));
    });
  });

  describe('createFollowUpTranche - Partial Fill Handling', () => {
    it('creates follow-up tranche for remaining shares', () => {
      const deps = createDeps(db);

      deps.strategicPlansRepo.create({
        id: 'plan1', symbol: 'AAPL', direction: 'ACCUMULATE',
        targetShares: 100, targetWeight: null, targetBudgetCents: null,
        trancheCount: 4, minDaysBetween: 5,
        entryCompositeScore: 0.75, convictionAtCreation: 0.8,
        status: 'ACTIVE', pauseReason: null, createdAt: Date.now(),
      });

      deps.planTranchesRepo.create({
        id: 't1', planId: 'plan1', trancheNumber: 1,
        shares: 25, priceCents: 15000, orderId: null,
        compositeScore: 0.75, regime: 'RISK_ON', executedAt: Date.now(),
      });

      const tranche = deps.planTranchesRepo.listByPlan('plan1')[0];

      // Partial fill: only 15 of 25 shares filled
      const followUpId = createFollowUpTranche(deps, tranche, 15, 15200);

      assert.ok(followUpId);

      const tranches = deps.planTranchesRepo.listByPlan('plan1');
      assert.equal(tranches.length, 2);

      // Original tranche updated to 15 shares
      const original = tranches.find(t => t.id === 't1');
      assert.equal(original?.shares, 15);

      // Follow-up tranche for remaining 10 shares
      const followUp = tranches.find(t => t.id === followUpId);
      assert.equal(followUp?.shares, 10);
      assert.equal(followUp?.priceCents, 15200);
    });

    it('returns null when no remaining shares', () => {
      const deps = createDeps(db);

      deps.strategicPlansRepo.create({
        id: 'plan1', symbol: 'AAPL', direction: 'ACCUMULATE',
        targetShares: 100, targetWeight: null, targetBudgetCents: null,
        trancheCount: 4, minDaysBetween: 5,
        entryCompositeScore: 0.75, convictionAtCreation: 0.8,
        status: 'ACTIVE', pauseReason: null, createdAt: Date.now(),
      });

      deps.planTranchesRepo.create({
        id: 't1', planId: 'plan1', trancheNumber: 1,
        shares: 25, priceCents: 15000, orderId: null,
        compositeScore: 0.75, regime: 'RISK_ON', executedAt: Date.now(),
      });

      const tranche = deps.planTranchesRepo.listByPlan('plan1')[0];

      // Full fill: all 25 shares filled
      const followUpId = createFollowUpTranche(deps, tranche, 25, 15200);

      assert.equal(followUpId, null);
    });

    it('returns null when plan is not active', () => {
      const deps = createDeps(db);

      deps.strategicPlansRepo.create({
        id: 'plan1', symbol: 'AAPL', direction: 'ACCUMULATE',
        targetShares: 100, targetWeight: null, targetBudgetCents: null,
        trancheCount: 4, minDaysBetween: 5,
        entryCompositeScore: 0.75, convictionAtCreation: 0.8,
        status: 'ACTIVE', pauseReason: null, createdAt: Date.now(),
      });

      deps.planTranchesRepo.create({
        id: 't1', planId: 'plan1', trancheNumber: 1,
        shares: 25, priceCents: 15000, orderId: null,
        compositeScore: 0.75, regime: 'RISK_ON', executedAt: Date.now(),
      });

      // Cancel the plan
      deps.strategicPlansRepo.updateStatus('plan1', 'CANCELLED', 'test');

      const tranche = deps.planTranchesRepo.listByPlan('plan1')[0];
      const followUpId = createFollowUpTranche(deps, tranche, 15, 15200);

      assert.equal(followUpId, null);
    });
  });
});
