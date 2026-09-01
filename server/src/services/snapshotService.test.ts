import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { SnapshotServiceImpl } from './snapshotService.js';
import { PortfolioServiceImpl } from './portfolioService.js';
import type { PriceFeed, HistoricalPrice } from './priceService.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { SnapshotsRepo } from '../repos/snapshotsRepo.js';
import { toETDateStr } from '../scheduler/marketCalendar.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../db/migrations');

/** Get today's date in YYYY-MM-DD format (ET timezone, matching snapshotService) */
function today(): string {
  return toETDateStr(new Date());
}

/** Get yesterday's date in YYYY-MM-DD format (ET timezone) */
function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toETDateStr(d);
}

/**
 * Mock PriceFeed for testing
 */
class MockPriceFeed implements PriceFeed {
  private priceMap: Map<string, number> = new Map();
  private barMap: Map<string, HistoricalPrice> = new Map();
  private shouldFailGetPrice = false;

  setPrice(symbol: string, priceDollars: number): void {
    this.priceMap.set(symbol, priceDollars);
  }

  setBar(symbol: string, date: string, bar: HistoricalPrice): void {
    this.barMap.set(`${symbol}:${date}`, bar);
  }

  setLatestBar(symbol: string, bar: HistoricalPrice): void {
    // Store as :latest suffix for getLatestBar
    this.barMap.set(`${symbol}:latest`, bar);
  }

  setFailGetPrice(fail: boolean): void {
    this.shouldFailGetPrice = fail;
  }

  async getPrice(symbol: string): Promise<number | null> {
    if (this.shouldFailGetPrice) {
      throw new Error('Mock price fetch failed');
    }
    return this.priceMap.get(symbol) ?? null;
  }

  async getLatestBar(symbol: string): Promise<HistoricalPrice | null> {
    const bar = this.barMap.get(`${symbol}:latest`);
    if (bar) return bar;

    // Fallback: return first bar we find
    for (const [key, barVal] of this.barMap.entries()) {
      if (key.startsWith(`${symbol}:`)) {
        return barVal;
      }
    }
    return null;
  }

  async getBar(symbol: string, date: string): Promise<HistoricalPrice | null> {
    return this.barMap.get(`${symbol}:${date}`) ?? null;
  }

  async getPrices(): Promise<Map<string, HistoricalPrice[]>> {
    return new Map();
  }
}

describe('SnapshotService', () => {
  let db: Database.Database;
  let service: SnapshotServiceImpl;
  let positionsRepo: PositionsRepo;
  let portfolioRepo: PortfolioRepo;
  let snapshotsRepo: SnapshotsRepo;
  let priceFeed: MockPriceFeed;
  let portfolioService: PortfolioServiceImpl;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);

    positionsRepo = new PositionsRepo(db);
    portfolioRepo = new PortfolioRepo(db);
    snapshotsRepo = new SnapshotsRepo(db);
    priceFeed = new MockPriceFeed();

    portfolioService = new PortfolioServiceImpl(db, priceFeed, positionsRepo, portfolioRepo);
    service = new SnapshotServiceImpl(priceFeed, portfolioService, portfolioRepo, snapshotsRepo);

    // Initialize portfolio with $100,000
    const now = Date.now();
    portfolioRepo.write({
      cashCents: 10000000,
      startingCashCents: 10000000,
      startedAt: now,
      resetAt: null,
      baseCurrency: 'USD',
    });
  });

  describe('captureSnapshot', () => {
    it('captures portfolio and benchmark snapshot successfully', async () => {
      // Set up SPY price
      priceFeed.setPrice('SPY', 450.00);

      const result = await service.captureSnapshot();

      assert.deepEqual(result.status, 'ok');
      assert.ok(result.portfolioSnapshotId);

      // Verify portfolio snapshot was written
      const snapshot = snapshotsRepo.getPortfolioSnapshot(today());
      assert.ok(snapshot);
      assert.equal(snapshot.cashCents, 10000000);
      assert.equal(snapshot.positionsValueCents, 0);
      assert.equal(snapshot.totalValueCents, 10000000);
      assert.equal(snapshot.unrealizedPnlCents, 0);
      assert.equal(snapshot.weightsJson, '[]');
    });

    it('includes position weights in snapshot', async () => {
      // Add a position
      positionsRepo.upsert({
        symbol: 'AAPL',
        qty: 100,
        avgCostCents: 15000,
        realizedPnlCents: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      priceFeed.setPrice('AAPL', 150.00);
      priceFeed.setPrice('SPY', 450.00);

      const result = await service.captureSnapshot();

      assert.equal(result.status, 'ok');

      // Verify weights
      const snapshot = snapshotsRepo.getPortfolioSnapshot(today());
      assert.ok(snapshot);
      assert.ok(snapshot.weightsJson);

      const weights = JSON.parse(snapshot.weightsJson);
      assert.equal(weights.length, 1);
      assert.equal(weights[0].symbol, 'AAPL');
      assert.ok(weights[0].weightPercent > 0);
      assert.ok(weights[0].weightPercent <= 100);
    });

    it('captures unrealized P&L in snapshot', async () => {
      // Add position with gains
      positionsRepo.upsert({
        symbol: 'AAPL',
        qty: 100,
        avgCostCents: 15000, // $150 avg cost
        realizedPnlCents: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      priceFeed.setPrice('AAPL', 160.00); // $10/share gain
      priceFeed.setPrice('SPY', 450.00);

      const result = await service.captureSnapshot();

      assert.equal(result.status, 'ok');

      const snapshot = snapshotsRepo.getPortfolioSnapshot(today());
      assert.ok(snapshot);
      assert.equal(snapshot.unrealizedPnlCents, 100000); // 100 shares * $10 gain = $1000 = 100000 cents
    });

    it('is idempotent - second call overwrites first', async () => {
      priceFeed.setPrice('SPY', 450.00);

      // First capture
      const result1 = await service.captureSnapshot();
      assert.equal(result1.status, 'ok');

      let snapshot = snapshotsRepo.getPortfolioSnapshot(today());
      const firstId = snapshot?.id;

      // Add a position and capture again
      positionsRepo.upsert({
        symbol: 'AAPL',
        qty: 100,
        avgCostCents: 15000,
        realizedPnlCents: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      priceFeed.setPrice('AAPL', 150.00);

      const result2 = await service.captureSnapshot();
      assert.equal(result2.status, 'ok');

      // Verify only one snapshot exists for the date (upserted)
      snapshot = snapshotsRepo.getPortfolioSnapshot(today());
      assert.ok(snapshot);
      // On conflict update, the id stays the same (not updated)
      assert.equal(snapshot.id, firstId);
      // But the weights should be updated (now has AAPL position)
      assert.ok(snapshot.weightsJson);
      const weights = JSON.parse(snapshot.weightsJson);
      assert.equal(weights.length, 1);
      assert.equal(weights[0].symbol, 'AAPL');
    });

    it('returns skipped when portfolio not initialized', async () => {
      // Clear the portfolio
      db.prepare('DELETE FROM portfolio').run();

      const result = await service.captureSnapshot();

      assert.deepEqual(result, { status: 'skipped', reason: 'portfolio_not_initialized' });
    });

    it('captures portfolio even if SPY fetch fails', async () => {
      priceFeed.setFailGetPrice(true);

      const result = await service.captureSnapshot();

      assert.equal(result.status, 'ok');
      assert.equal(result.benchmarkSnapshotId, null);

      // Verify portfolio was still captured
      const snapshot = snapshotsRepo.getPortfolioSnapshot(today());
      assert.ok(snapshot);
      assert.equal(snapshot.cashCents, 10000000);
    });

    it('falls back to latest bar if SPY price unavailable', async () => {
      // Don't set price, but set latest bar
      const bar: HistoricalPrice = {
        barDate: yesterday(),
        openCents: 45000,
        highCents: 45000,
        lowCents: 45000,
        closeCents: 45000,
        adjCloseCents: 45000,
        volume: 1000000,
      };
      priceFeed.setLatestBar('SPY', bar);

      const result = await service.captureSnapshot();

      assert.equal(result.status, 'ok');
      assert.ok(result.benchmarkSnapshotId);

      // Verify benchmark was written
      const benchmarkSnapshot = snapshotsRepo.getBenchmarkSnapshot('SPY', today());
      assert.ok(benchmarkSnapshot);
      assert.equal(benchmarkSnapshot.closeCents, 45000);
    });

    it('handles empty positions with empty weights array', async () => {
      priceFeed.setPrice('SPY', 450.00);

      const result = await service.captureSnapshot();

      assert.equal(result.status, 'ok');

      const snapshot = snapshotsRepo.getPortfolioSnapshot(today());
      assert.ok(snapshot);
      assert.equal(snapshot.weightsJson, '[]');
    });

    it('handles multiple positions with correct total weights', async () => {
      // Add two positions
      positionsRepo.upsert({
        symbol: 'AAPL',
        qty: 50,
        avgCostCents: 15000,
        realizedPnlCents: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      positionsRepo.upsert({
        symbol: 'GOOGL',
        qty: 100,
        avgCostCents: 10000,
        realizedPnlCents: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      priceFeed.setPrice('AAPL', 150.00);
      priceFeed.setPrice('GOOGL', 100.00);
      priceFeed.setPrice('SPY', 450.00);

      const result = await service.captureSnapshot();

      assert.equal(result.status, 'ok');

      const snapshot = snapshotsRepo.getPortfolioSnapshot(today());
      assert.ok(snapshot);

      const weights = JSON.parse(snapshot.weightsJson!);
      assert.equal(weights.length, 2);

      // Verify each weight is positive and less than 100
      for (const weight of weights) {
        assert.ok(weight.weightPercent > 0);
        assert.ok(weight.weightPercent < 100);
      }

      // Verify symbols are correct
      const symbols = weights.map((w: { symbol: string }) => w.symbol).sort();
      assert.deepEqual(symbols, ['AAPL', 'GOOGL']);
    });
  });
});
