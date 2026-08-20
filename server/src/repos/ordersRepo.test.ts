import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.ts';
import { OrdersRepo } from './ordersRepo.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../db/migrations');

describe('OrdersRepo', () => {
  let db: Database.Database;
  let repo: OrdersRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);
    repo = new OrdersRepo(db);
  });

  describe('list()', () => {
    it('returns empty array when no orders exist', () => {
      const result = repo.list();
      assert.deepEqual(result, []);
    });

    it('returns all orders when no filter provided', () => {
      const now = Date.now();
      const id1 = repo.create({
        clientOrderId: 'coid-1',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'filled',
        rejectReason: null,
        submittedAt: now,
      });

      const id2 = repo.create({
        clientOrderId: 'coid-2',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'GOOGL',
        side: 'sell',
        qty: 5,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'pending',
        rejectReason: null,
        submittedAt: now + 1000,
      });

      const result = repo.list();
      assert.equal(result.length, 2);
      assert.equal(result[0].id, id2); // DESC by submitted_at
      assert.equal(result[1].id, id1);
    });

    it('filters by status', () => {
      const now = Date.now();
      repo.create({
        clientOrderId: 'coid-1',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'filled',
        rejectReason: null,
        submittedAt: now,
      });

      repo.create({
        clientOrderId: 'coid-2',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'GOOGL',
        side: 'sell',
        qty: 5,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'rejected',
        rejectReason: 'Insufficient shares',
        submittedAt: now + 1000,
      });

      repo.create({
        clientOrderId: 'coid-3',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'MSFT',
        side: 'buy',
        qty: 20,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'pending',
        rejectReason: null,
        submittedAt: now + 2000,
      });

      const result = repo.list({ status: ['rejected'] });
      assert.equal(result.length, 1);
      assert.equal(result[0].clientOrderId, 'coid-2');
      assert.equal(result[0].rejectReason, 'Insufficient shares');
    });

    it('filters by multiple statuses', () => {
      const now = Date.now();
      repo.create({
        clientOrderId: 'coid-1',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'filled',
        rejectReason: null,
        submittedAt: now,
      });

      repo.create({
        clientOrderId: 'coid-2',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'GOOGL',
        side: 'sell',
        qty: 5,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'rejected',
        rejectReason: 'Insufficient shares',
        submittedAt: now + 1000,
      });

      repo.create({
        clientOrderId: 'coid-3',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'MSFT',
        side: 'buy',
        qty: 20,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'pending',
        rejectReason: null,
        submittedAt: now + 2000,
      });

      const result = repo.list({ status: ['filled', 'rejected'] });
      assert.equal(result.length, 2);
      assert.equal(result[0].clientOrderId, 'coid-2');
      assert.equal(result[1].clientOrderId, 'coid-1');
    });

    it('filters by since timestamp', () => {
      const baseTime = Date.now();
      repo.create({
        clientOrderId: 'coid-1',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'filled',
        rejectReason: null,
        submittedAt: baseTime,
      });

      repo.create({
        clientOrderId: 'coid-2',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'GOOGL',
        side: 'sell',
        qty: 5,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'filled',
        rejectReason: null,
        submittedAt: baseTime + 5000,
      });

      repo.create({
        clientOrderId: 'coid-3',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'MSFT',
        side: 'buy',
        qty: 20,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'filled',
        rejectReason: null,
        submittedAt: baseTime + 10000,
      });

      const result = repo.list({ since: baseTime + 6000 });
      assert.equal(result.length, 1);
      assert.equal(result[0].clientOrderId, 'coid-3');
    });

    it('combines status and since filters', () => {
      const baseTime = Date.now();
      repo.create({
        clientOrderId: 'coid-1',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'filled',
        rejectReason: null,
        submittedAt: baseTime,
      });

      repo.create({
        clientOrderId: 'coid-2',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'GOOGL',
        side: 'sell',
        qty: 5,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'rejected',
        rejectReason: 'Insufficient shares',
        submittedAt: baseTime + 5000,
      });

      repo.create({
        clientOrderId: 'coid-3',
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: 'MSFT',
        side: 'buy',
        qty: 20,
        type: 'market',
        limitPriceCents: null,
        tif: 'day',
        status: 'rejected',
        rejectReason: 'Insufficient cash',
        submittedAt: baseTime + 10000,
      });

      const result = repo.list({ status: ['rejected'], since: baseTime + 6000 });
      assert.equal(result.length, 1);
      assert.equal(result[0].clientOrderId, 'coid-3');
    });
  });
});
