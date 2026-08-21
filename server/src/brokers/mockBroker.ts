/**
 * MockBroker for backtesting.
 * Fills orders at historical prices with configurable slippage.
 */

import type { Broker, BrokerPosition, Account, OrderRequest, OrderState, OrderStatus } from './types.js';
import { randomUUID } from 'crypto';
import { notionalCents } from '../lib/money.js';

export interface MockBrokerConfig {
  slippageBps: number;
  commissionCents: number;
  startingCashCents: number;
}

interface MockPosition {
  symbol: string;
  qty: number;
  avgCostCents: number;
}

interface MockOrder {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type: 'market' | 'limit';
  limitPriceCents?: number;
  tif: 'day' | 'gtc';
  status: OrderStatus;
  rejectReason?: string;
  submittedAt: number;
  updatedAt: number;
  fillPriceCents?: number;
  fillDate?: string;
}

export interface HistoricalPriceProvider {
  getPrice(symbol: string, date: string): Promise<{ openCents: number; closeCents: number } | null>;
}

export class MockBroker implements Broker {
  readonly id = 'mock';
  readonly supportsFractionalShares = true;

  private cashCents: number;
  private positions = new Map<string, MockPosition>();
  private orders = new Map<string, MockOrder>();
  private readonly config: MockBrokerConfig;
  private readonly priceProvider: HistoricalPriceProvider;
  private currentDate: string = '';

  constructor(priceProvider: HistoricalPriceProvider, config: Partial<MockBrokerConfig> = {}) {
    this.config = {
      slippageBps: config.slippageBps ?? 5,
      commissionCents: config.commissionCents ?? 0,
      startingCashCents: config.startingCashCents ?? 100_000_00, // $100k default
    };
    this.cashCents = this.config.startingCashCents;
    this.priceProvider = priceProvider;
  }

  /** Set the current simulation date for order fills */
  setCurrentDate(date: string): void {
    this.currentDate = date;
  }

  /** Reset broker state for a new backtest */
  reset(): void {
    this.cashCents = this.config.startingCashCents;
    this.positions.clear();
    this.orders.clear();
  }

  async getAccount(): Promise<Account> {
    let equityCents = 0;
    for (const pos of this.positions.values()) {
      if (pos.qty > 0) {
        const price = await this.priceProvider.getPrice(pos.symbol, this.currentDate);
        if (price) {
          equityCents += notionalCents(pos.qty, price.closeCents);
        }
      }
    }

    return {
      cashCents: this.cashCents,
      equityCents,
      buyingPowerCents: this.cashCents + equityCents,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return Array.from(this.positions.values())
      .filter(p => p.qty > 0)
      .map(p => ({
        symbol: p.symbol,
        qty: p.qty,
        avgCostCents: p.avgCostCents,
      }));
  }

  async submitOrder(req: OrderRequest): Promise<OrderState> {
    // Idempotency check
    for (const order of this.orders.values()) {
      if (order.clientOrderId === req.clientOrderId) {
        return this.toOrderState(order);
      }
    }

    const now = Date.now();
    const orderId = randomUUID();

    const order: MockOrder = {
      id: orderId,
      clientOrderId: req.clientOrderId,
      symbol: req.symbol,
      side: req.side,
      qty: req.qty,
      type: req.type,
      limitPriceCents: req.limitPriceCents,
      tif: req.tif,
      status: 'pending',
      submittedAt: now,
      updatedAt: now,
    };

    // Get price for fill
    const price = await this.priceProvider.getPrice(req.symbol, this.currentDate);
    if (!price) {
      order.status = 'rejected';
      order.rejectReason = 'No price data for symbol';
      this.orders.set(orderId, order);
      return this.toOrderState(order);
    }

    // Calculate fill price with slippage
    const basePriceCents = price.closeCents;
    const slippageFraction = this.config.slippageBps / 10000;
    const fillPriceCents = req.side === 'buy'
      ? Math.round(basePriceCents * (1 + slippageFraction))
      : Math.round(basePriceCents * (1 - slippageFraction));

    // Validate sell orders
    if (req.side === 'sell') {
      const position = this.positions.get(req.symbol);
      if (!position || position.qty < req.qty) {
        order.status = 'rejected';
        order.rejectReason = 'Insufficient shares to sell';
        this.orders.set(orderId, order);
        return this.toOrderState(order);
      }
    }

    // Validate buy orders
    if (req.side === 'buy') {
      const totalCost = notionalCents(req.qty, fillPriceCents) + this.config.commissionCents;
      if (totalCost > this.cashCents) {
        order.status = 'rejected';
        order.rejectReason = 'Insufficient cash';
        this.orders.set(orderId, order);
        return this.toOrderState(order);
      }
    }

    // Execute the fill
    this.executeFill(order, fillPriceCents);
    order.status = 'filled';
    order.fillPriceCents = fillPriceCents;
    order.fillDate = this.currentDate;
    order.updatedAt = Date.now();

    this.orders.set(orderId, order);
    return this.toOrderState(order);
  }

  async getOrder(orderId: string): Promise<OrderState | null> {
    const order = this.orders.get(orderId);
    return order ? this.toOrderState(order) : null;
  }

  async listOrders(f: { status?: OrderStatus[]; since?: number }): Promise<OrderState[]> {
    let orders = Array.from(this.orders.values());
    if (f.status) {
      orders = orders.filter(o => f.status!.includes(o.status));
    }
    if (f.since) {
      orders = orders.filter(o => o.submittedAt >= f.since!);
    }
    return orders.map(o => this.toOrderState(o));
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.status === 'filled' || order.status === 'canceled' || order.status === 'rejected') {
      throw new Error(`Cannot cancel order in ${order.status} status`);
    }
    order.status = 'canceled';
    order.updatedAt = Date.now();
  }

  async getClock(): Promise<{ isOpen: boolean; nextOpen: number; nextClose: number }> {
    return { isOpen: true, nextOpen: Date.now(), nextClose: Date.now() + 6.5 * 60 * 60 * 1000 };
  }

  /** Get current portfolio value at a specific date */
  async getPortfolioValue(date: string): Promise<number> {
    let equityCents = 0;
    for (const pos of this.positions.values()) {
      if (pos.qty > 0) {
        const price = await this.priceProvider.getPrice(pos.symbol, date);
        if (price) {
          equityCents += notionalCents(pos.qty, price.closeCents);
        }
      }
    }
    return this.cashCents + equityCents;
  }

  /** Get current positions snapshot */
  getPositionsSnapshot(): Array<{ symbol: string; qty: number; avgCostCents: number }> {
    return Array.from(this.positions.values())
      .filter(p => p.qty > 0)
      .map(p => ({ symbol: p.symbol, qty: p.qty, avgCostCents: p.avgCostCents }));
  }

  getCashCents(): number {
    return this.cashCents;
  }

  private executeFill(order: MockOrder, fillPriceCents: number): void {
    const notional = notionalCents(order.qty, fillPriceCents);

    if (order.side === 'buy') {
      this.cashCents -= notional + this.config.commissionCents;

      const existing = this.positions.get(order.symbol);
      if (existing) {
        const newQty = existing.qty + order.qty;
        const newAvgCost = Math.round(
          (existing.qty * existing.avgCostCents + order.qty * fillPriceCents) / newQty
        );
        existing.qty = newQty;
        existing.avgCostCents = newAvgCost;
      } else {
        this.positions.set(order.symbol, {
          symbol: order.symbol,
          qty: order.qty,
          avgCostCents: fillPriceCents,
        });
      }
    } else {
      this.cashCents += notional - this.config.commissionCents;

      const existing = this.positions.get(order.symbol)!;
      existing.qty -= order.qty;
      if (existing.qty <= 0) {
        this.positions.delete(order.symbol);
      }
    }
  }

  private toOrderState(order: MockOrder): OrderState {
    return {
      id: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      type: order.type,
      limitPriceCents: order.limitPriceCents ?? null,
      fillPriceCents: order.fillPriceCents ?? null,
      fillDate: order.fillDate ?? null,
      tif: order.tif,
      status: order.status,
      rejectReason: order.rejectReason ?? null,
      submittedAt: order.submittedAt,
      updatedAt: order.updatedAt,
    };
  }
}
