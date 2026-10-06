/**
 * MockBroker for backtesting.
 * Fills orders at historical prices with configurable slippage.
 */
import { randomUUID } from 'crypto';
import { notionalCents } from '../lib/money.js';
export class MockBroker {
    id = 'mock';
    supportsFractionalShares = true;
    cashCents;
    positions = new Map();
    orders = new Map();
    config;
    priceProvider;
    currentDate = '';
    lastKnownPrices = new Map(); // Track last known price per symbol
    constructor(priceProvider, config = {}) {
        this.config = {
            slippageBps: config.slippageBps ?? 5,
            commissionCents: config.commissionCents ?? 0,
            startingCashCents: config.startingCashCents ?? 100_000_00, // $100k default
        };
        this.cashCents = this.config.startingCashCents;
        this.priceProvider = priceProvider;
    }
    /** Set the current simulation date for order fills */
    setCurrentDate(date) {
        this.currentDate = date;
    }
    /** Reset broker state for a new backtest */
    reset() {
        this.cashCents = this.config.startingCashCents;
        this.positions.clear();
        this.orders.clear();
    }
    async getAccount() {
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
    async getPositions() {
        return Array.from(this.positions.values())
            .filter(p => p.qty > 0)
            .map(p => ({
            symbol: p.symbol,
            qty: p.qty,
            avgCostCents: p.avgCostCents,
        }));
    }
    async submitOrder(req) {
        // Idempotency check
        for (const order of this.orders.values()) {
            if (order.clientOrderId === req.clientOrderId) {
                return this.toOrderState(order);
            }
        }
        const now = Date.now();
        const orderId = randomUUID();
        const order = {
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
    async getOrder(orderId) {
        const order = this.orders.get(orderId);
        return order ? this.toOrderState(order) : null;
    }
    async listOrders(f) {
        let orders = Array.from(this.orders.values());
        if (f.status) {
            orders = orders.filter(o => f.status.includes(o.status));
        }
        if (f.since) {
            orders = orders.filter(o => o.submittedAt >= f.since);
        }
        return orders.map(o => this.toOrderState(o));
    }
    async cancelOrder(orderId) {
        const order = this.orders.get(orderId);
        if (!order)
            throw new Error(`Order ${orderId} not found`);
        if (order.status === 'filled' || order.status === 'canceled' || order.status === 'rejected') {
            throw new Error(`Cannot cancel order in ${order.status} status`);
        }
        order.status = 'canceled';
        order.updatedAt = Date.now();
    }
    async getClock() {
        return { isOpen: true, nextOpen: Date.now(), nextClose: Date.now() + 6.5 * 60 * 60 * 1000 };
    }
    /** Get current portfolio value at a specific date */
    async getPortfolioValue(date) {
        let equityCents = 0;
        for (const pos of this.positions.values()) {
            if (pos.qty > 0) {
                const price = await this.priceProvider.getPrice(pos.symbol, date);
                if (price) {
                    this.lastKnownPrices.set(pos.symbol, price.closeCents);
                    equityCents += notionalCents(pos.qty, price.closeCents);
                }
                else {
                    // Use last known price on holidays/missing data
                    const lastPrice = this.lastKnownPrices.get(pos.symbol);
                    if (lastPrice) {
                        equityCents += notionalCents(pos.qty, lastPrice);
                    }
                }
            }
        }
        return this.cashCents + equityCents;
    }
    /** Get current positions snapshot */
    getPositionsSnapshot() {
        return Array.from(this.positions.values())
            .filter(p => p.qty > 0)
            .map(p => ({ symbol: p.symbol, qty: p.qty, avgCostCents: p.avgCostCents }));
    }
    getCashCents() {
        return this.cashCents;
    }
    executeFill(order, fillPriceCents) {
        const notional = notionalCents(order.qty, fillPriceCents);
        if (order.side === 'buy') {
            this.cashCents -= notional + this.config.commissionCents;
            const existing = this.positions.get(order.symbol);
            if (existing) {
                const newQty = existing.qty + order.qty;
                const newAvgCost = Math.round((existing.qty * existing.avgCostCents + order.qty * fillPriceCents) / newQty);
                existing.qty = newQty;
                existing.avgCostCents = newAvgCost;
            }
            else {
                this.positions.set(order.symbol, {
                    symbol: order.symbol,
                    qty: order.qty,
                    avgCostCents: fillPriceCents,
                });
            }
        }
        else {
            this.cashCents += notional - this.config.commissionCents;
            const existing = this.positions.get(order.symbol);
            existing.qty -= order.qty;
            if (existing.qty <= 0) {
                this.positions.delete(order.symbol);
            }
        }
    }
    toOrderState(order) {
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
//# sourceMappingURL=mockBroker.js.map