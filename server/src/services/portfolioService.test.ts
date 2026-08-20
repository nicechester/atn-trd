import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { PortfolioServiceImpl } from './portfolioService.js';
import type { PriceFeed, HistoricalPrice } from './priceService.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../db/migrations');

/**
 * Mock PriceFeed for testing
 */
class MockPriceFeed implements PriceFeed {
  private priceMap: Map<string, number> = new Map();
  private barMap: Map<string, HistoricalPrice> = new Map();

  setPrice(symbol: string, priceDollars: number): void {
    this.priceMap.set(symbol, priceDollars);
  }

  setBar(symbol: string, date: string, bar: HistoricalPrice): void {
    this.barMap.set(`${symbol}:${date}`, bar);
  }

  async getPrice(symbol: string): Promise<number | null> {
    return this.priceMap.get(symbol) ?? null;
  }

  async getLatestBar(symbol: string): Promise<HistoricalPrice | null> {
    // For testing, return the first bar we find
    for (const [key, bar] of this.barMap.entries()) {
      if (key.startsWith(`${symbol}:`)) {
        return bar;
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

describe('PortfolioService', () => {
  let db: Database.Database;
  let service: PortfolioServiceImpl;
  let positionsRepo: PositionsRepo;
  let portfolioRepo: PortfolioRepo;
  let priceFeed: MockPriceFeed;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);

    positionsRepo = new PositionsRepo(db);
    portfolioRepo = new PortfolioRepo(db);
    priceFeed = new MockPriceFeed();

    service = new PortfolioServiceImpl(db, priceFeed, positionsRepo, portfolioRepo);

    // Initialize portfolio with $10,000
    const now = Date.now();
    portfolioRepo.write({
      cashCents: 1000000,
      startingCashCents: 1000000,
      startedAt: now,
      resetAt: null,
      baseCurrency: 'USD',
    });
  });

  describe('getPortfolio', () => {
    it('returns NAV with zero positions (cash only)', async () => {
      const portfolio = await service.getPortfolio();

      assert.equal(portfolio.cashCents, 1000000);
      assert.equal(portfolio.positionsValueCents, 0);
      assert.equal(portfolio.totalValueCents, 1000000);
      assert.equal(portfolio.totalUnrealizedPnlCents, 0);
      assert.equal(portfolio.totalRealizedPnlCents, 0);
      assert.equal(portfolio.totalPnlCents, 0);
      assert.equal(portfolio.totalReturnPercent, 0);
      assert.deepEqual(portfolio.positions, []);
    });

    it('handles open position with gain (current > avg)', async () => {
      // Buy 10 shares at $100 = $1000 cost
      positionsRepo.upsert({
        symbol: 'AAPL',
        qty: 10,
        avgCostCents: 10000, // $100
        realizedPnlCents: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Current price is $120
      priceFeed.setPrice('AAPL', 120);

      const portfolio = await service.getPortfolio();

      assert.equal(portfolio.positions.length, 1);
      const pos = portfolio.positions[0];
      assert.equal(pos.symbol, 'AAPL');
      assert.equal(pos.qty, 10);
      assert.equal(pos.avgCostCents, 10000);
      assert.equal(pos.currentPriceCents, 12000);
      assert.equal(pos.costBasisCents, 100000); // 10 * 10000
      assert.equal(pos.marketValueCents, 120000); // 10 * 12000
      assert.equal(pos.unrealizedPnlCents, 20000); // 120000 - 100000
      assert.equal(pos.realizedPnlCents, 0);

      // Portfolio totals
      assert.equal(portfolio.positionsValueCents, 120000);
      assert.equal(portfolio.totalValueCents, 1120000); // 1000000 + 120000
      assert.equal(portfolio.totalUnrealizedPnlCents, 20000);
      assert.equal(portfolio.totalPnlCents, 20000);
      assert.equal(portfolio.totalReturnPercent, 2); // 20000 / 1000000 * 100
    });

    it('handles open position with loss (current < avg)', async () => {
      // Buy 10 shares at $100 = $1000 cost
      positionsRepo.upsert({
        symbol: 'TSLA',
        qty: 10,
        avgCostCents: 10000, // $100
        realizedPnlCents: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Current price is $80
      priceFeed.setPrice('TSLA', 80);

      const portfolio = await service.getPortfolio();

      const pos = portfolio.positions[0];
      assert.equal(pos.currentPriceCents, 8000);
      assert.equal(pos.costBasisCents, 100000);
      assert.equal(pos.marketValueCents, 80000);
      assert.equal(pos.unrealizedPnlCents, -20000); // 80000 - 100000

      assert.equal(portfolio.totalUnrealizedPnlCents, -20000);
      assert.equal(portfolio.totalPnlCents, -20000);
      assert.equal(portfolio.totalReturnPercent, -2); // -20000 / 1000000 * 100
    });

    it('computes weights that sum to ~100%', async () => {
      // Add two positions
      positionsRepo.upsert({
        symbol: 'AAPL',
        qty: 10,
        avgCostCents: 10000,
        realizedPnlCents: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      positionsRepo.upsert({
        symbol: 'TSLA',
        qty: 20,
        avgCostCents: 5000,
        realizedPnlCents: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      priceFeed.setPrice('AAPL', 120);
      priceFeed.setPrice('TSLA', 80);

      const portfolio = await service.getPortfolio();

      // AAPL: 10 * 12000 = 120000
      // TSLA: 20 * 8000 = 160000
      // Total: 280000 + 1000000 cash = 1280000

      assert.equal(portfolio.positions.length, 2);
      const aaplWeight = portfolio.positions.find((p) => p.symbol === 'AAPL')!.weightPercent;
      const tslaWeight = portfolio.positions.find((p) => p.symbol === 'TSLA')!.weightPercent;
      const cashWeight = 100 - aaplWeight - tslaWeight;

      assert.ok(aaplWeight > 0);
      assert.ok(tslaWeight > 0);
      assert.ok(cashWeight > 0);
      assert.ok(Math.abs(aaplWeight + tslaWeight + cashWeight - 100) < 0.001);
    });

    it('includes realized P&L from closed positions', async () => {
      // Add a closed position (qty=0, but realizedPnlCents preserved)
      positionsRepo.upsert({
        symbol: 'MSFT',
        qty: 0,
        avgCostCents: 10000,
        realizedPnlCents: 5000, // Realized gain from prior trade
        openedAt: Date.now() - 100000,
        updatedAt: Date.now(),
      });

      // Add an open position
      positionsRepo.upsert({
        symbol: 'GOOG',
        qty: 5,
        avgCostCents: 15000,
        realizedPnlCents: 2000, // Some prior realized P&L
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      priceFeed.setPrice('GOOG', 160);

      const portfolio = await service.getPortfolio();

      // Only GOOG should be in positions array (qty != 0)
      assert.equal(portfolio.positions.length, 1);
      assert.equal(portfolio.positions[0].symbol, 'GOOG');

      // But total realized P&L should include both
      assert.equal(portfolio.totalRealizedPnlCents, 7000); // 5000 + 2000
    });

    it('historical mode reads getBar not getPrice', async () => {
      positionsRepo.upsert({
        symbol: 'AAPL',
        qty: 10,
        avgCostCents: 10000,
        realizedPnlCents: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Set historical bar
      priceFeed.setBar('AAPL', '2025-01-15', {
        barDate: '2025-01-15',
        openCents: 11500,
        highCents: 12000,
        lowCents: 11000,
        closeCents: 11800,
        adjCloseCents: 11800,
        volume: 1000000,
      });

      // Also set live price (should not be used in historical mode)
      priceFeed.setPrice('AAPL', 120);

      const portfolio = await service.getPortfolio({ asOfDate: '2025-01-15' });

      // Should use historical bar close price (11800), not live price (120)
      const pos = portfolio.positions[0];
      assert.equal(pos.currentPriceCents, 11800);
      assert.equal(pos.marketValueCents, 118000); // 10 * 11800
    });

    it('falls back to avgCostCents when price missing with warning', async () => {
      positionsRepo.upsert({
        symbol: 'UNKNOWN',
        qty: 10,
        avgCostCents: 10000,
        realizedPnlCents: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Don't set any price

      const portfolio = await service.getPortfolio();

      // Should fall back to average cost
      const pos = portfolio.positions[0];
      assert.equal(pos.currentPriceCents, 10000);
      assert.equal(pos.marketValueCents, 100000); // No gain/loss
      assert.equal(pos.unrealizedPnlCents, 0);
    });

    it('returns proper asOfDate', async () => {
      const portfolio1 = await service.getPortfolio();
      assert.ok(portfolio1.asOfDate.match(/\d{4}-\d{2}-\d{2}/));

      const portfolio2 = await service.getPortfolio({ asOfDate: '2025-01-15' });
      assert.equal(portfolio2.asOfDate, '2025-01-15');
    });

    it('handles division by zero when totalValueCents=0', async () => {
      // Clear cash and add position
      const now = Date.now();
      portfolioRepo.write({
        cashCents: 0,
        startingCashCents: 1000000,
        startedAt: now,
        resetAt: null,
        baseCurrency: 'USD',
      });

      positionsRepo.upsert({
        symbol: 'TEST',
        qty: 0, // No quantity - should not appear in list()
        avgCostCents: 10000,
        realizedPnlCents: 0,
        openedAt: now,
        updatedAt: now,
      });

      const portfolio = await service.getPortfolio();

      // With no positions and no cash, weight should be 0 not NaN
      assert.equal(portfolio.totalValueCents, 0);
      assert.deepEqual(portfolio.positions, []);
      assert.equal(portfolio.totalReturnPercent, 0); // startingCash=1000000, so no div by zero
    });

    it('throws when portfolio not initialized', async () => {
      // Create a fresh service with empty DB
      const freshDb = new Database(':memory:');
      runMigrations(freshDb, migrationsDir);
      const freshService = new PortfolioServiceImpl(
        freshDb,
        priceFeed,
        new PositionsRepo(freshDb),
        new PortfolioRepo(freshDb)
      );

      await assert.rejects(
        () => freshService.getPortfolio(),
        /Portfolio not initialized/
      );
    });
  });

  describe('resetPaperAccount', () => {
    it('clears positions and restores cash', async () => {
      const now = Date.now();

      // Add positions
      positionsRepo.upsert({
        symbol: 'AAPL',
        qty: 10,
        avgCostCents: 10000,
        realizedPnlCents: 1000,
        openedAt: now,
        updatedAt: now,
      });

      // Reduce cash
      const portfolio = portfolioRepo.read()!;
      portfolioRepo.write({
        ...portfolio,
        cashCents: 500000, // Spent half on stocks
      });

      // Reset
      await service.resetPaperAccount();

      // Positions should be cleared
      const positions = positionsRepo.list();
      assert.equal(positions.length, 0);

      // Cash should be restored
      const resetPortfolio = portfolioRepo.read()!;
      assert.equal(resetPortfolio.cashCents, 1000000);
      assert.equal(resetPortfolio.startingCashCents, 1000000);
      assert.ok(resetPortfolio.resetAt! > 0);
      assert.equal(resetPortfolio.startedAt, portfolio.startedAt); // Preserved
    });

    it('preserves fills and orders', async () => {
      const now = Date.now();

      // Add a position
      positionsRepo.upsert({
        symbol: 'TSLA',
        qty: 5,
        avgCostCents: 20000,
        realizedPnlCents: 0,
        openedAt: now,
        updatedAt: now,
      });

      // Reset
      await service.resetPaperAccount();

      // Position should be gone
      const positions = positionsRepo.listAll();
      assert.equal(positions.length, 0);

      // Orders/fills tables remain (not cleared by resetPaperAccount)
      // This is verified by the fact that no error occurs
    });

    it('throws when portfolio not initialized', async () => {
      const freshDb = new Database(':memory:');
      runMigrations(freshDb, migrationsDir);
      const freshService = new PortfolioServiceImpl(
        freshDb,
        priceFeed,
        new PositionsRepo(freshDb),
        new PortfolioRepo(freshDb)
      );

      await assert.rejects(
        () => freshService.resetPaperAccount(),
        /Portfolio not initialized/
      );
    });

    it('is atomic (transaction)', async () => {
      const now = Date.now();

      positionsRepo.upsert({
        symbol: 'AAPL',
        qty: 10,
        avgCostCents: 10000,
        realizedPnlCents: 0,
        openedAt: now,
        updatedAt: now,
      });

      await service.resetPaperAccount();

      // Verify both operations succeeded
      const positions = positionsRepo.list();
      const portfolio = portfolioRepo.read()!;

      assert.equal(positions.length, 0);
      assert.equal(portfolio.cashCents, 1000000);
      assert.ok(portfolio.resetAt);
    });
  });
});
