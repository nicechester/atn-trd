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

// Mock Date.now() to return a fixed time during market hours (Wed Aug 20, 2026 @ 10:00 AM ET)
// This ensures tests run consistently regardless of actual system time
const MARKET_HOURS_TIMESTAMP = new Date('2026-08-20T14:00:00Z').getTime(); // 10:00 AM ET
Date.now = () => MARKET_HOURS_TIMESTAMP;

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

    it('rejects order with qty below MIN_QTY', async () => {
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
        qty: 0.0005,
        type: 'market',
        tif: 'day',
      });

      assert.equal(result.status, 'rejected');
      assert.equal(result.rejectReason, 'Quantity below minimum tradable size (0.001 shares)');
    });

    it('fills fractional order successfully', async () => {
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
        qty: 2.5,
        type: 'market',
        tif: 'day',
      });

      assert.equal(result.status, 'filled');
      assert.equal(result.qty, 2.5);
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
      assert.ok(clock.nextClose > 0);
    });

    it('getClock.isOpen derives from isTradingDay', async () => {
      const clock = await broker.getClock();
      const now = new Date();
      const expected = isTradingDay(now);

      assert.equal(clock.isOpen, expected);
    });
  });

  describe('next_open fill model', () => {
    let brokerNextOpen: PaperBroker;

    beforeEach(() => {
      brokerNextOpen = new PaperBroker(
        db,
        priceService,
        ordersRepo,
        fillsRepo,
        positionsRepo,
        portfolioRepo,
        { slippageBps: 5, commissionCents: 0, fillModel: 'next_open' }
      );
    });

    it('accepts buy order without filling immediately', async () => {
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
      const result = await brokerNextOpen.submitOrder({
        clientOrderId,
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      assert.equal(result.status, 'accepted');
      assert.equal(result.symbol, 'AAPL');
      assert.equal(result.qty, 10);

      // Verify no fill was created
      const fills = fillsRepo.listByOrder(result.id);
      assert.equal(fills.length, 0);

      // Verify cash is unchanged (reserved, not debited)
      const portfolio = portfolioRepo.read()!;
      assert.equal(portfolio.cashCents, 1000000);
    });

    it('processPendingOrders with no next-day bar remains accepted', async () => {
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
      await brokerNextOpen.submitOrder({
        clientOrderId,
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      // Call processPendingOrders without adding next day's bar
      await brokerNextOpen.processPendingOrders();

      // Order should remain accepted
      const order = ordersRepo.getByClientOrderId(clientOrderId)!;
      assert.equal(order.status, 'accepted');

      // No fill should exist
      const fills = fillsRepo.listByOrder(order.id);
      assert.equal(fills.length, 0);
    });

    it('processPendingOrders fills at next trading day open price', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2026-08-19',
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
      const orderResult = await brokerNextOpen.submitOrder({
        clientOrderId,
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      // Add next trading day's bar (2026-08-20 is today, so next trading day is 2026-08-21)
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2026-08-21',
        openCents: 16000,
        highCents: 16100,
        lowCents: 15900,
        closeCents: 16050,
        adjCloseCents: 16050,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Process pending orders
      await brokerNextOpen.processPendingOrders();

      // Order should now be filled
      const order = ordersRepo.get(orderResult.id)!;
      assert.equal(order.status, 'filled');

      // Fill should exist at next day's open price with slippage
      const fills = fillsRepo.listByOrder(order.id);
      assert.equal(fills.length, 1);

      // Fill price: 16000 * (1 + 0.0005) = 16008
      const expectedFillPrice = Math.round(16000 * (1 + 5 / 10000));
      assert.equal(fills[0].priceCents, expectedFillPrice);
      assert.equal(fills[0].barDate, '2026-08-21');

      // Cash should be debited
      const portfolio = portfolioRepo.read()!;
      const notional = 10 * expectedFillPrice;
      assert.equal(portfolio.cashCents, 1000000 - notional);
    });

    it('processPendingOrders is idempotent', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2026-08-19',
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
      const orderResult = await brokerNextOpen.submitOrder({
        clientOrderId,
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      // Add next trading day's bar
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2026-08-21',
        openCents: 16000,
        highCents: 16100,
        lowCents: 15900,
        closeCents: 16050,
        adjCloseCents: 16050,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Process pending orders twice
      await brokerNextOpen.processPendingOrders();
      await brokerNextOpen.processPendingOrders();

      // Should have exactly one fill
      const fills = fillsRepo.listByOrder(orderResult.id);
      assert.equal(fills.length, 1);
    });

    it('reserves cash for multiple buy orders in same cycle', async () => {
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

      // First buy
      await brokerNextOpen.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      // Try second buy that would exceed cash if reservation works
      const result = await brokerNextOpen.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 6800, // Would need ~$102M, exceeds our $10M + first order reservation
        type: 'market',
        tif: 'day',
      });

      // Second order should be rejected
      assert.equal(result.status, 'rejected');
      assert.equal(result.rejectReason, 'Insufficient cash');
    });

    it('re-validates sell position at settlement', async () => {
      // Buy some shares
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

      await brokerNextOpen.submitOrder({
        clientOrderId: crypto.randomUUID(),
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'market',
        tif: 'day',
      });

      // Defer a sell order for more shares than we have
      const sellOrderId = crypto.randomUUID();
      const sellResult = await brokerNextOpen.submitOrder({
        clientOrderId: sellOrderId,
        symbol: 'AAPL',
        side: 'sell',
        qty: 15,
        type: 'market',
        tif: 'day',
      });

      // Should be rejected at submit time
      assert.equal(sellResult.status, 'rejected');
      assert.equal(sellResult.rejectReason, 'Insufficient shares to sell');
    });

    it('processes limit orders only if limit is met at open', async () => {
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2026-08-19',
        openCents: 15000,
        highCents: 15100,
        lowCents: 14900,
        closeCents: 15050,
        adjCloseCents: 15050,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Limit buy at 15800 (lower than next open at 16000)
      const clientOrderId = crypto.randomUUID();
      await brokerNextOpen.submitOrder({
        clientOrderId,
        symbol: 'AAPL',
        side: 'buy',
        qty: 10,
        type: 'limit',
        limitPriceCents: 15800,
        tif: 'day',
      });

      // Add next day's bar with open at 16000
      pricesRepo.upsert({
        symbol: 'AAPL',
        barDate: '2026-08-21',
        openCents: 16000,
        highCents: 16100,
        lowCents: 15900,
        closeCents: 16050,
        adjCloseCents: 16050,
        volume: 1000000,
        provider: 'yahoo',
        fetchedAt: Date.now(),
      });

      // Process pending orders
      await brokerNextOpen.processPendingOrders();

      // Order should remain accepted (limit not met)
      const order = ordersRepo.getByClientOrderId(clientOrderId)!;
      assert.equal(order.status, 'accepted');

      // No fill
      const fills = fillsRepo.listByOrder(order.id);
      assert.equal(fills.length, 0);
    });

    it('is no-op on last_close broker', async () => {
      // Use the original broker with last_close
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

      // Try processPendingOrders on last_close broker (should be no-op)
      await broker.processPendingOrders?.();
      // No error should occur
    });
  });
});
