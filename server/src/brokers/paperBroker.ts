import type Database from 'better-sqlite3';
import { Broker, BrokerPosition, Account, OrderRequest, OrderState, OrderStatus } from './types.js';
import { PriceFeed, HistoricalPrice } from '../services/priceService.js';
import { OrdersRepo, type OrderRow } from '../repos/ordersRepo.js';
import { FillsRepo } from '../repos/fillsRepo.js';
import { PositionsRepo, type PositionRow } from '../repos/positionsRepo.js';
import { PortfolioRepo, type PortfolioRow } from '../repos/portfolioRepo.js';
import { notionalCents } from '../lib/money.js';
import { isTradingDay, nextSessionOpen, nextSessionClose, nextTradingDateStr, toETDateStr } from '../scheduler/marketCalendar.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'paper-broker' });

export interface PaperBrokerConfig {
  fillModel: 'last_close' | 'next_open';
  slippageBps: number;  // default 5
  commissionCents: number;  // default 0
}

const DEFAULT_CONFIG: PaperBrokerConfig = {
  fillModel: 'last_close',
  slippageBps: 5,
  commissionCents: 0,
};

/**
 * PaperBroker: simulated broker using cached price bars for fills.
 * Implements order state machine: pending → accepted → filled (with rejection branches)
 * Deterministic fills at last_close price with slippage
 * Idempotent clientOrderId handling
 * Position tracking with weighted-average cost
 * Portfolio cash tracking
 */
export class PaperBroker implements Broker {
  readonly id = 'paper';
  readonly supportsFractionalShares = true;

  private readonly priceFeed: PriceFeed;
  private readonly ordersRepo: OrdersRepo;
  private readonly fillsRepo: FillsRepo;
  private readonly positionsRepo: PositionsRepo;
  private readonly portfolioRepo: PortfolioRepo;
  private readonly db: Database.Database;
  private readonly config: PaperBrokerConfig;
  private reservedCashCents = 0;

  constructor(
    db: Database.Database,
    priceFeed: PriceFeed,
    ordersRepo: OrdersRepo,
    fillsRepo: FillsRepo,
    positionsRepo: PositionsRepo,
    portfolioRepo: PortfolioRepo,
    config: Partial<PaperBrokerConfig> = {}
  ) {
    this.db = db;
    this.priceFeed = priceFeed;
    this.ordersRepo = ordersRepo;
    this.fillsRepo = fillsRepo;
    this.positionsRepo = positionsRepo;
    this.portfolioRepo = portfolioRepo;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async getAccount(): Promise<Account> {
    const portfolio = this.portfolioRepo.read();
    if (!portfolio) {
      throw new Error('Portfolio not initialized');
    }

    // Calculate equity from positions
    let equityCents = 0;
    const positions = this.positionsRepo.listAll();

    for (const pos of positions) {
      if (pos.qty !== 0) {
        const latestBar = await this.priceFeed.getLatestBar(pos.symbol);
        if (latestBar) {
          equityCents += notionalCents(pos.qty, latestBar.closeCents);
        }
      }
    }

    const totalCents = portfolio.cashCents + equityCents;

    return {
      cashCents: portfolio.cashCents,
      equityCents,
      buyingPowerCents: totalCents, // In paper trading, buying power = total account value
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return this.positionsRepo
      .listAll()
      .filter((pos) => pos.qty !== 0)
      .map((pos) => ({
        symbol: pos.symbol,
        qty: pos.qty,
        avgCostCents: pos.avgCostCents,
      }));
  }

  async submitOrder(req: OrderRequest): Promise<OrderState> {
    // Check for idempotency: if clientOrderId exists, return it unchanged
    const existing = this.ordersRepo.getByClientOrderId(req.clientOrderId);
    if (existing) {
      return this.rowToState(existing);
    }

    const now = Date.now();
    const portfolio = this.portfolioRepo.read();
    if (!portfolio) {
      throw new Error('Portfolio not initialized');
    }

    // Get latest bar to validate symbol and check fill price
    const latestBar = await this.priceFeed.getLatestBar(req.symbol);
    if (!latestBar) {
      // Reject for unknown symbol
      const orderId = this.ordersRepo.create({
        clientOrderId: req.clientOrderId,
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: req.symbol,
        side: req.side,
        qty: req.qty,
        type: req.type,
        limitPriceCents: req.limitPriceCents ?? null,
        tif: req.tif,
        status: 'pending',
        rejectReason: null,
        submittedAt: now,
      });

      this.ordersRepo.updateStatus(orderId, 'rejected', undefined, 'No price data for symbol');
      return this.rowToState(this.ordersRepo.get(orderId)!);
    }

    // Validate qty
    if (req.qty <= 0) {
      const orderId = this.ordersRepo.create({
        clientOrderId: req.clientOrderId,
        decisionId: null,
        runId: null,
        broker: 'paper',
        brokerOrderId: null,
        mode: 'paper',
        symbol: req.symbol,
        side: req.side,
        qty: req.qty,
        type: req.type,
        limitPriceCents: req.limitPriceCents ?? null,
        tif: req.tif,
        status: 'pending',
        rejectReason: null,
        submittedAt: now,
      });

      this.ordersRepo.updateStatus(orderId, 'rejected', undefined, 'Quantity must be positive');
      return this.rowToState(this.ordersRepo.get(orderId)!);
    }

    // Validate sell orders (no shorting in v1)
    if (req.side === 'sell') {
      const position = this.positionsRepo.get(req.symbol);
      if (!position || position.qty < req.qty) {
        const orderId = this.ordersRepo.create({
          clientOrderId: req.clientOrderId,
          decisionId: null,
          runId: null,
          broker: 'paper',
          brokerOrderId: null,
          mode: 'paper',
          symbol: req.symbol,
          side: req.side,
          qty: req.qty,
          type: req.type,
          limitPriceCents: req.limitPriceCents ?? null,
          tif: req.tif,
          status: 'pending',
          rejectReason: null,
          submittedAt: now,
        });

        this.ordersRepo.updateStatus(orderId, 'rejected', undefined, 'Insufficient shares to sell');
        return this.rowToState(this.ordersRepo.get(orderId)!);
      }
    }

    // Create order in pending status
    const orderId = this.ordersRepo.create({
      clientOrderId: req.clientOrderId,
      decisionId: null,
      runId: null,
      broker: 'paper',
      brokerOrderId: null,
      mode: 'paper',
      symbol: req.symbol,
      side: req.side,
      qty: req.qty,
      type: req.type,
      limitPriceCents: req.limitPriceCents ?? null,
      tif: req.tif,
      status: 'pending',
      rejectReason: null,
      submittedAt: now,
    });

    // Calculate fill price with slippage
    const estimateFillPriceCents = this.calculateFillPrice(req.side, latestBar.closeCents);

    // Handle next_open fill model
    if (this.config.fillModel === 'next_open') {
      const check = this.tryFillOrder(orderId, req, latestBar, estimateFillPriceCents, portfolio);
      if (check.rejected) {
        this.ordersRepo.updateStatus(orderId, 'rejected', undefined, check.rejectReason);
        return this.rowToState(this.ordersRepo.get(orderId)!);
      }
      if (req.side === 'buy') {
        this.reservedCashCents += notionalCents(req.qty, estimateFillPriceCents) + this.config.commissionCents;
      }
      this.ordersRepo.updateStatus(orderId, 'accepted');
      log.debug('order deferred to next_open settlement', { orderId, symbol: req.symbol });
      return this.rowToState(this.ordersRepo.get(orderId)!);
    }

    // Handle last_close fill model (existing logic)
    // For limit orders, reject if limit would be violated
    if (req.type === 'limit' && req.limitPriceCents !== undefined) {
      if (req.side === 'buy' && estimateFillPriceCents > req.limitPriceCents) {
        this.ordersRepo.updateStatus(orderId, 'accepted');
        log.debug('limit order accepted but not filled', { orderId, symbol: req.symbol });
        return this.rowToState(this.ordersRepo.get(orderId)!);
      }
      if (req.side === 'sell' && estimateFillPriceCents < req.limitPriceCents) {
        this.ordersRepo.updateStatus(orderId, 'accepted');
        log.debug('limit order accepted but not filled', { orderId, symbol: req.symbol });
        return this.rowToState(this.ordersRepo.get(orderId)!);
      }
    }

    // Try to fill the order
    const fillResult = this.tryFillOrder(orderId, req, latestBar, estimateFillPriceCents, portfolio);

    if (fillResult.rejected) {
      this.ordersRepo.updateStatus(orderId, 'rejected', undefined, fillResult.rejectReason);
      return this.rowToState(this.ordersRepo.get(orderId)!);
    }

    // Fill order in transaction
    if (fillResult.shouldFill) {
      this.executeOrder(orderId, req, latestBar, estimateFillPriceCents);
    }

    // Move from pending to accepted
    const finalStatus = fillResult.shouldFill ? 'filled' : 'accepted';
    this.ordersRepo.updateStatus(orderId, finalStatus);

    return this.rowToState(this.ordersRepo.get(orderId)!);
  }

  async getOrder(orderId: string): Promise<OrderState | null> {
    const row = this.ordersRepo.get(orderId);
    return row ? this.rowToState(row) : null;
  }

  async listOrders(f: { status?: OrderStatus[]; since?: number }): Promise<OrderState[]> {
    const rows = this.ordersRepo.list(f);
    return rows.map((row) => this.rowToState(row));
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = this.ordersRepo.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.status === 'filled' || order.status === 'canceled' || order.status === 'rejected') {
      throw new Error(`Cannot cancel order in ${order.status} status`);
    }

    this.ordersRepo.updateStatus(orderId, 'canceled');
  }

  async getClock(): Promise<{ isOpen: boolean; nextOpen: number; nextClose: number }> {
    const now = new Date();
    const isOpen = isTradingDay(now);

    const nextOpen = nextSessionOpen(now);
    const nextClose = nextSessionClose(now);

    return {
      isOpen,
      nextOpen: nextOpen.getTime(),
      nextClose: nextClose.getTime(),
    };
  }

  async processPendingOrders(): Promise<void> {
    if (this.config.fillModel !== 'next_open') return;

    const pending = this.ordersRepo
      .list({ status: ['accepted'] })
      .filter((o) => o.broker === this.id);

    let filled = 0, rejected = 0, stillPending = 0;

    for (const order of pending) {
      // Settlement date is the next trading day after order submission
      const settlementDateStr = nextTradingDateStr(toETDateStr(new Date(order.submittedAt)));
      const bar = await this.priceFeed.getBar(order.symbol, settlementDateStr);
      if (!bar) { stillPending++; continue; }

      const fillPriceCents = this.calculateFillPrice(order.side, bar.openCents);

      if (order.type === 'limit' && order.limitPriceCents !== null &&
          ((order.side === 'buy' && fillPriceCents > order.limitPriceCents) ||
           (order.side === 'sell' && fillPriceCents < order.limitPriceCents))) {
        stillPending++; continue;
      }

      const portfolio = this.portfolioRepo.read();
      if (!portfolio) { log.warn('portfolio not initialized during settlement'); continue; }

      const result = this.tryFillOrder(order.id, order, bar, fillPriceCents, portfolio);
      if (result.rejected) {
        this.ordersRepo.updateStatus(order.id, 'rejected', undefined, result.rejectReason);
        rejected++; continue;
      }

      this.executeOrder(order.id, order, bar, fillPriceCents);
      this.ordersRepo.updateStatus(order.id, 'filled');
      filled++;
    }

    log.info('processed pending orders', { evaluated: pending.length, filled, rejected, stillPending });
  }

  // ── private helpers ──

  private rowToState(row: OrderRow): OrderState {
    return {
      id: row.id,
      clientOrderId: row.clientOrderId,
      symbol: row.symbol,
      side: row.side,
      qty: row.qty,
      type: row.type,
      limitPriceCents: row.limitPriceCents,
      tif: row.tif,
      status: row.status,
      rejectReason: row.rejectReason,
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
    };
  }

  private calculateFillPrice(side: 'buy' | 'sell', basePriceCents: number): number {
    const slippageFraction = this.config.slippageBps / 10000;

    if (side === 'buy') {
      // Slippage increases buy price
      return Math.round(basePriceCents * (1 + slippageFraction));
    } else {
      // Slippage decreases sell price
      return Math.round(basePriceCents * (1 - slippageFraction));
    }
  }

  private tryFillOrder(
    _orderId: string,
    req: OrderRequest | { symbol: string; side: 'buy' | 'sell'; qty: number },
    _bar: HistoricalPrice,
    fillPriceCents: number,
    portfolio: PortfolioRow
  ): { rejected: boolean; shouldFill: boolean; rejectReason?: string } {
    if (req.side === 'buy') {
      // Check cash availability (accounting for reserved cash from pending next_open orders)
      const notional = notionalCents(req.qty, fillPriceCents);
      const totalCost = notional + this.config.commissionCents;
      const availableCash = portfolio.cashCents - this.reservedCashCents;

      if (totalCost > availableCash) {
        return {
          rejected: true,
          shouldFill: false,
          rejectReason: 'Insufficient cash',
        };
      }

      return { rejected: false, shouldFill: true };
    } else {
      // Sell order - check position availability
      const position = this.positionsRepo.get(req.symbol);
      if (!position || position.qty < req.qty) {
        return {
          rejected: true,
          shouldFill: false,
          rejectReason: 'Insufficient shares to sell',
        };
      }
      return { rejected: false, shouldFill: true };
    }
  }

  private executeOrder(
    orderId: string,
    req: OrderRequest,
    bar: HistoricalPrice,
    fillPriceCents: number
  ): void {
    const now = Date.now();
    const portfolio = this.portfolioRepo.read();
    if (!portfolio) {
      throw new Error('Portfolio not initialized');
    }

    this.db.transaction(() => {
      // Create fill
      const fillId = this.fillsRepo.create({
        orderId,
        qty: req.qty,
        priceCents: fillPriceCents,
        feeCents: this.config.commissionCents,
        filledAt: now,
        barDate: bar.barDate,
      });

      log.debug('fill created', { fillId, orderId, qty: req.qty, priceCents: fillPriceCents });

      // Update portfolio cash
      const notional = notionalCents(req.qty, fillPriceCents);
      let newCashCents = portfolio.cashCents;

      if (req.side === 'buy') {
        newCashCents -= notional + this.config.commissionCents;
      } else {
        newCashCents += notional - this.config.commissionCents;
      }

      this.portfolioRepo.write({
        ...portfolio,
        cashCents: newCashCents,
      });

      log.debug('portfolio cash updated', { oldCash: portfolio.cashCents, newCash: newCashCents });

      // Update position with weighted-average cost
      const position = this.positionsRepo.get(req.symbol);
      let newPosition: PositionRow;

      if (!position) {
        // New position
        newPosition = {
          symbol: req.symbol,
          qty: req.side === 'buy' ? req.qty : -req.qty,
          avgCostCents: fillPriceCents,
          realizedPnlCents: 0,
          openedAt: now,
          updatedAt: now,
        };
      } else {
        const oldQty = position.qty;
        const newQty = req.side === 'buy' ? oldQty + req.qty : oldQty - req.qty;

        if (req.side === 'buy') {
          // Weighted-average cost on buy
          const newAvgCostCents =
            Math.round((oldQty * position.avgCostCents + req.qty * fillPriceCents) / newQty);

          newPosition = {
            symbol: req.symbol,
            qty: newQty,
            avgCostCents: newAvgCostCents,
            realizedPnlCents: position.realizedPnlCents,
            openedAt: position.openedAt,
            updatedAt: now,
          };
        } else {
          // Sell: realize P&L
          const costBasis = notionalCents(req.qty, position.avgCostCents);
          const proceeds = notional;
          const pnl = proceeds - costBasis;

          newPosition = {
            symbol: req.symbol,
            qty: newQty,
            avgCostCents: newQty !== 0 ? position.avgCostCents : 0,
            realizedPnlCents: position.realizedPnlCents + pnl,
            openedAt: position.openedAt,
            updatedAt: now,
          };
        }
      }

      this.positionsRepo.upsert(newPosition);

      log.debug('position updated', {
        symbol: req.symbol,
        qty: newPosition.qty,
        avgCostCents: newPosition.avgCostCents,
      });
    })();
  }
}
