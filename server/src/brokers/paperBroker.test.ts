import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.ts';
import { PaperBroker } from './paperBroker.ts';
import { PriceService } from '../services/priceService.ts';
import { OrdersRepo } from '../repos/ordersRepo.ts';
import { FillsRepo } from '../repos/fillsRepo.ts';
import { PositionsRepo } from '../repos/positionsRepo.ts';
import { PortfolioRepo } from '../repos/portfolioRepo.ts';
import { PricesRepo } from '../repos/pricesRepo.ts';
import { isTradingDay } from '../scheduler/marketCalendar.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../db/migrations');

describe('PaperBroker', () => {
  let db: Database.Database;
  let broker: PaperBroker;
  let pricesRepo: PricesRepo;
  let priceService: PriceService;
  let ordersRepo: OrdersRepo;
  let fillsRepo: FillsRepo;
  let positionsRepo: PositionsRepo;
  let portfolioRepo: PortfolioRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);

    pricesRepo = new PricesRepo(db);
    priceService = new PriceService(pricesRepo);
    ordersRepo = new OrdersRepo(db);
    fillsRepo = new FillsRepo(db);
    positionsRepo = new PositionsRepo(db);
    portfolioRepo = new PortfolioRepo(db);

    // Initialize portfolio with $10,000
    portfolioRepo.write({
      cashCents: 1000000,
      startingCashCents: 1000000,
      startedAt: Date.now(),
      resetAt: null,
      baseCurrency: 'USD',
    });

    broker = new PaperBroker(
      db,
      priceService,
      ordersRepo,
      fillsRepo,
      positionsRepo,
      portfolioRepo,
      { slippageBps: 5, commissionCents: 0, fillModel: 'last_close' }
    );
  });

  describe('submitOrder', () => {
    it('creates a pending order and transitions to accepted/filled', async () => {
      // Set up a price bar for AAPL
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 15000,
        highCents: 15100,
        lowCents: 14900,
        closeCents: 15050,
        adjCloseCents: 15050,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      const clientOrderId = crypto.randomUUID();
      const result = await broker.submitOrder({
        clientOrderId,
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      assert.equal(result.status, 'filled');
      assert.equal(result.clientOrderId, clientOrderId);
      assert.equal(result.symbol, 'AAPL');
      assert.equal(result.qty, 10);
    });

    it('is idempotent on clientOrderId', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 15000,
        highCents: 15100,
        lowCents: 14900,
        closeCents: 15050,
        adjCloseCents: 15050,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      const clientOrderId = 'idempotent-order-1';

      const result1 = await broker.submitOrder({
        clientOrderId,
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const result2 = await broker.submitOrder({
        clientOrderId,
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      assert.equal(result1.id, result2.id);
      assert.equal(result1.status, result2.status);

      // Verify only one order exists in database
      const allOrders = ordersRepo.list();
      assert.equal(allOrders.length, 1);
    });

    it('rejects order for unknown symbol', async () => {
      const result = await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'UNKNOWN',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      assert.equal(result.status, 'rejected');
      assert.equal(result.rejectReason, 'No price data for symbol');
    });

    it('rejects order with qty <= 0', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 15000,
        highCents: 15100,
        lowCents: 14900,
        closeCents: 15050,
        adjCloseCents: 15050,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      const result = await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 0,
        type: 'market',
        tif: 'day',
      });

      assert.equal(result.status, 'rejected');
      assert.equal(result.rejectReason, 'Quantity must be positive');
    });

    it('rejects sell order for insufficient shares', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 15000,
        highCents: 15100,
        lowCents: 14900,
        closeCents: 15050,
        adjCloseCents: 15050,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      const result = await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'sell',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      assert.equal(result.status, 'rejected');
      assert.equal(result.rejectReason, 'Insufficient shares to sell');
    });

    it('rejects buy order for insufficient cash', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 15000,
        highCents: 15100,
        lowCents: 14900,
        closeCents: 15050,
        adjCloseCents: 15050,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Try to buy more than cash available
      const result = await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 1000, // ~$150,000 worth
        type: 'market',
        tif: 'day',
      });

      assert.equal(result.status, 'rejected');
      assert.equal(result.rejectReason, 'Insufficient cash');
    });

    it('applies slippage correctly on buy (increases price)', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 15000,
        highCents: 15100,
        lowCents: 14900,
        closeCents: 15000,
        adjCloseCents: 15000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      const clientOrderId = crypto.randomUUID();
      await broker.submitOrder({
        clientOrderId,
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const fills = fillsRepo.listByOrder(ordersRepo.getByClientOrderId(clientOrderId)!.id);
      assert.equal(fills.length, 1);

      // With 5 bps slippage: 15000 * (1 + 0.0005) = 15007.5 -> 15008 cents (rounded)
      const expectedFillPrice = Math.round(15000 * (1 + 5 / 10000));
      assert.equal(fills[0].priceCents, expectedFillPrice);
      assert.equal(fills[0].priceCents, 15008);
    });

    it('applies slippage correctly on sell (decreases price)', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 15000,
        highCents: 15100,
        lowCents: 14900,
        closeCents: 15000,
        adjCloseCents: 15000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // First buy some shares
      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      // Then sell them
      const sellOrderId = crypto.randomUUID();
      await broker.submitOrder({
        clientOrderId: sellOrderId,
        symbol: 'AAPL',
        side: 'sell',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const fills = fillsRepo.listByOrder(ordersRepo.getByClientOrderId(sellOrderId)!.id);
      assert.equal(fills.length, 1);

      // With 5 bps slippage: 15000 * (1 - 0.0005) = 14992.5 -> 14993 cents (rounded)
      const expectedFillPrice = Math.round(15000 * (1 - 5 / 10000));
      assert.equal(fills[0].priceCents, expectedFillPrice);
      assert.equal(fills[0].priceCents, 14993);
    });

    it('handles limit orders that cannot be filled', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 15000,
        highCents: 15100,
        lowCents: 14900,
        closeCents: 15000,
        adjCloseCents: 15000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Buy limit at 14900 when price is 15000
      // With slippage, buy fill price would be ~15007, so limit is violated
      const result = await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'limit',
        limitPriceCents: 14900,
        tif: 'day',
      });

      assert.equal(result.status, 'accepted');
      // No fill should be created
      const fills = fillsRepo.listByOrder(result.id);
      assert.equal(fills.length, 0);
    });
  });

  describe('Position tracking with weighted-average cost', () => {
    it('calculates weighted-average cost on multiple buys', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 10000,
        highCents: 10100,
        lowCents: 9900,
        closeCents: 10000,
        adjCloseCents: 10000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Buy 10 @ $100
      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      // Change price and buy 10 more @ $110
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-16',
        openCents: 11000,
        highCents: 11100,
        lowCents: 10900,
        closeCents: 11000,
        adjCloseCents: 11000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const position = positionsRepo.get('AAPL');
      assert.ok(position);
      assert.equal(position.qty, 20);

      // Weighted-average: (10 * 10000 + 10 * 11000) / 20 = 10500
      // But with slippage, actual fill prices are higher
      // Buy 1: 10000 * (1 + 0.0005) ≈ 10005
      // Buy 2: 11000 * (1 + 0.0005) ≈ 11005.5
      // WAC: (10 * 10005 + 10 * 11005) / 20 = 10505
      assert.ok(position.avgCostCents > 10000);
      assert.ok(position.avgCostCents < 11100);
    });

    it('realizes P&L on sell', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 10000,
        highCents: 10100,
        lowCents: 9900,
        closeCents: 10000,
        adjCloseCents: 10000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Buy 10 @ ~$100
      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      // Change price to sell at profit
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-16',
        openCents: 12000,
        highCents: 12100,
        lowCents: 11900,
        closeCents: 12000,
        adjCloseCents: 12000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      const positionBefore = positionsRepo.get('AAPL')!;
      const realizedPnlBefore = positionBefore.realizedPnlCents;

      // Sell 10 @ ~$120 (with slippage)
      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'sell',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const positionAfter = positionsRepo.get('AAPL')!;

      // Position qty should be 0
      assert.equal(positionAfter.qty, 0);

      // P&L should be positive
      const pnl = positionAfter.realizedPnlCents - realizedPnlBefore;
      assert.ok(pnl > 0);
    });

    it('keeps zero-qty position row with realized P&L history', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 10000,
        highCents: 10100,
        lowCents: 9900,
        closeCents: 10000,
        adjCloseCents: 10000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Buy 10 @ ~$100
      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      // Sell all at profit
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-16',
        openCents: 12000,
        highCents: 12100,
        lowCents: 11900,
        closeCents: 12000,
        adjCloseCents: 12000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'sell',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      // Position row should still exist with qty=0 but realized P&L preserved
      const position = positionsRepo.get('AAPL');
      assert.ok(position);
      assert.equal(position.qty, 0);
      assert.ok(position.realizedPnlCents > 0);
    });
  });

  describe('Portfolio cash tracking', () => {
    it('deducts cash on buy', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 10000,
        highCents: 10100,
        lowCents: 9900,
        closeCents: 10000,
        adjCloseCents: 10000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      const portfolioBefore = portfolioRepo.read()!;

      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const portfolioAfter = portfolioRepo.read()!;

      // Cash should decrease by ~notional
      assert.ok(portfolioAfter.cashCents < portfolioBefore.cashCents);
    });

    it('adds cash on sell', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 10000,
        highCents: 10100,
        lowCents: 9900,
        closeCents: 10000,
        adjCloseCents: 10000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Buy 10 @ ~$100
      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const portfolioAfterBuy = portfolioRepo.read()!;

      // Sell at higher price
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-16',
        openCents: 12000,
        highCents: 12100,
        lowCents: 11900,
        closeCents: 12000,
        adjCloseCents: 12000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'sell',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const portfolioAfterSell = portfolioRepo.read()!;

      // Cash should increase from sell proceeds
      assert.ok(portfolioAfterSell.cashCents > portfolioAfterBuy.cashCents);
    });
  });

  describe('getOrder', () => {
    it('returns the order state', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 15000,
        highCents: 15100,
        lowCents: 14900,
        closeCents: 15050,
        adjCloseCents: 15050,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      const submitted = await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const retrieved = await broker.getOrder(submitted.id);
      assert.ok(retrieved);
      assert.deepEqual(retrieved, submitted);
    });

    it('returns null for non-existent order', async () => {
      const result = await broker.getOrder('non-existent-id');
      assert.equal(result, null);
    });
  });

  describe('listOrders', () => {
    it('lists orders by status', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 15000,
        highCents: 15100,
        lowCents: 14900,
        closeCents: 15050,
        adjCloseCents: 15050,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Create a filled order
      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      // Create a rejected order
      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'UNKNOWN',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const filled = await broker.listOrders({ status: ['filled'] });
      const rejected = await broker.listOrders({ status: ['rejected'] });

      assert.equal(filled.length, 1);
      assert.equal(filled[0].status, 'filled');

      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].status, 'rejected');
    });
  });

  describe('getAccount', () => {
    it('returns account with cash, equity, and buying power', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 10000,
        highCents: 10100,
        lowCents: 9900,
        closeCents: 10000,
        adjCloseCents: 10000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Buy 10 @ ~$100
      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const account = await broker.getAccount();

      assert.ok(account.cashCents > 0);
      assert.ok(account.equityCents > 0);
      assert.ok(account.buyingPowerCents > account.cashCents);
    });
  });

  describe('getPositions', () => {
    it('returns non-zero positions', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2025-01-15',
        openCents: 10000,
        highCents: 10100,
        lowCents: 9900,
        closeCents: 10000,
        adjCloseCents: 10000,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      await broker.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      const positions = await broker.getPositions();
      assert.equal(positions.length, 1);
      assert.equal(positions[0].symbol, 'AAPL');
      assert.equal(positions[0].qty, 10);
    });
  });

  describe('getClock', () => {
    it('derives isOpen and next open/close from market calendar', async () => {
      const clock = await broker.getClock();

      assert.equal(typeof clock.isOpen, 'boolean');
      assert.equal(typeof clock.nextOpen, 'number');
      assert.equal(typeof clock.nextClose, 'number');
      assert.ok(clock.nextOpen > 0);
      assert.ok(clock.nextClose > clock.nextOpen);
    });

    it('getClock.isOpen derives from isTradingDay', async () => {
      const clock = await broker.getClock();
      const now = new Date();
      const expected = isTradingDay(now);

      assert.equal(clock.isOpen, expected);
    });
  });
});
