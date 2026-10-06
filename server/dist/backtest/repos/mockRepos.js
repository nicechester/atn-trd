/**
 * In-memory mock implementations of repositories for backtesting.
 * Uses Maps/Arrays instead of SQLite for fast, isolated execution.
 */
import { randomUUID } from 'crypto';
// ── Signal Snapshots ──────────────────────────────────────────────────────────
export class MockSignalSnapshotsRepo {
    snapshots = new Map(); // key: symbol:date
    key(symbol, date) {
        return `${symbol}:${date}`;
    }
    insert(row) {
        const k = this.key(row.symbol, row.snapshotDate);
        if (this.snapshots.has(k))
            return false;
        this.snapshots.set(k, row);
        return true;
    }
    get(symbol, snapshotDate) {
        return this.snapshots.get(this.key(symbol, snapshotDate));
    }
    getLatest(symbol) {
        const symbolSnapshots = Array.from(this.snapshots.values())
            .filter(s => s.symbol === symbol)
            .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
        return symbolSnapshots[0];
    }
    listBySymbol(symbol, limit = 30) {
        return Array.from(this.snapshots.values())
            .filter(s => s.symbol === symbol)
            .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))
            .slice(0, limit);
    }
    getRecentSnapshots(symbol, days) {
        return this.listBySymbol(symbol, days);
    }
    getRecentSentiment(symbol, days) {
        return this.listBySymbol(symbol, days)
            .filter(s => s.sentimentScore !== null)
            .map(s => ({ snapshotDate: s.snapshotDate, sentimentScore: s.sentimentScore }));
    }
    clear() {
        this.snapshots.clear();
    }
}
// ── Strategic Plans ───────────────────────────────────────────────────────────
export class MockStrategicPlansRepo {
    plans = new Map();
    create(plan) {
        const fullPlan = {
            ...plan,
            executedShares: 0,
            tranchesExecuted: 0,
            lastTrancheAt: null,
            completedAt: null,
        };
        this.plans.set(plan.id, fullPlan);
    }
    get(id) {
        return this.plans.get(id);
    }
    getActiveBySymbol(symbol) {
        return Array.from(this.plans.values()).find(p => p.symbol === symbol && p.status === 'ACTIVE');
    }
    listActive() {
        return Array.from(this.plans.values())
            .filter(p => p.status === 'ACTIVE')
            .sort((a, b) => a.createdAt - b.createdAt);
    }
    listPaused() {
        return Array.from(this.plans.values())
            .filter(p => p.status === 'PAUSED')
            .sort((a, b) => a.createdAt - b.createdAt);
    }
    listBySymbol(symbol) {
        return Array.from(this.plans.values())
            .filter(p => p.symbol === symbol)
            .sort((a, b) => b.createdAt - a.createdAt);
    }
    updateStatus(id, status, pauseReason) {
        const plan = this.plans.get(id);
        if (!plan)
            return;
        plan.status = status;
        plan.pauseReason = pauseReason ?? null;
        if (status === 'COMPLETED' || status === 'CANCELLED') {
            plan.completedAt = Date.now();
        }
    }
    recordTrancheExecution(id, shares, timestamp) {
        const plan = this.plans.get(id);
        if (!plan)
            return;
        plan.executedShares += shares;
        plan.tranchesExecuted += 1;
        plan.lastTrancheAt = timestamp ?? Date.now();
    }
    clear() {
        this.plans.clear();
    }
}
// ── Plan Tranches ─────────────────────────────────────────────────────────────
export class MockPlanTranchesRepo {
    tranches = new Map();
    create(tranche) {
        const fullTranche = {
            ...tranche,
            orderStatus: 'PENDING',
            totalCostCents: null,
            filledAt: null,
        };
        this.tranches.set(tranche.id, fullTranche);
    }
    listByPlan(planId) {
        return Array.from(this.tranches.values())
            .filter(t => t.planId === planId)
            .sort((a, b) => a.trancheNumber - b.trancheNumber);
    }
    getLatestByPlan(planId) {
        const planTranches = this.listByPlan(planId);
        return planTranches[planTranches.length - 1];
    }
    listPending() {
        return Array.from(this.tranches.values())
            .filter(t => t.orderStatus === 'PENDING')
            .sort((a, b) => a.executedAt - b.executedAt);
    }
    updateStatus(id, status, totalCostCents, filledAt) {
        const tranche = this.tranches.get(id);
        if (!tranche)
            return;
        tranche.orderStatus = status;
        if (totalCostCents !== undefined)
            tranche.totalCostCents = totalCostCents;
        if (filledAt !== undefined)
            tranche.filledAt = filledAt;
    }
    updateShares(id, shares) {
        const tranche = this.tranches.get(id);
        if (tranche)
            tranche.shares = shares;
    }
    clear() {
        this.tranches.clear();
    }
}
// ── Market Regime ─────────────────────────────────────────────────────────────
export class MockMarketRegimeRepo {
    regimes = new Map(); // key: asOfDate
    upsert(row) {
        this.regimes.set(row.asOfDate, row);
    }
    get(asOfDate) {
        return this.regimes.get(asOfDate);
    }
    getLatest() {
        const sorted = Array.from(this.regimes.values())
            .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
        return sorted[0];
    }
    getRecentRegimes(days) {
        return Array.from(this.regimes.values())
            .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))
            .slice(0, days);
    }
    getRegimeStreak(regime) {
        const recent = this.getRecentRegimes(10);
        let streak = 0;
        for (const row of recent) {
            if (row.regime === regime)
                streak++;
            else
                break;
        }
        return streak;
    }
    clear() {
        this.regimes.clear();
    }
}
// ── Portfolio ─────────────────────────────────────────────────────────────────
export class MockPortfolioRepo {
    portfolio;
    read() {
        return this.portfolio;
    }
    write(row) {
        this.portfolio = row;
    }
    clear() {
        this.portfolio = undefined;
    }
}
// ── Positions ─────────────────────────────────────────────────────────────────
export class MockPositionsRepo {
    positions = new Map();
    upsert(position) {
        this.positions.set(position.symbol, position);
    }
    get(symbol) {
        return this.positions.get(symbol);
    }
    list() {
        return Array.from(this.positions.values()).filter(p => p.qty !== 0);
    }
    listAll() {
        return Array.from(this.positions.values());
    }
    remove(symbol) {
        this.positions.delete(symbol);
    }
    clear() {
        this.positions.clear();
    }
    getTotalQtyCost() {
        let totalQty = 0;
        let totalCostCents = 0;
        for (const pos of this.positions.values()) {
            if (pos.qty > 0) {
                totalQty += pos.qty;
                totalCostCents += pos.qty * pos.avgCostCents;
            }
        }
        return { totalQty, totalCostCents };
    }
}
// ── Prices ────────────────────────────────────────────────────────────────────
export class MockPricesRepo {
    prices = new Map(); // key: symbol:date
    latestBySymbol = new Map(); // symbol -> latest date
    key(symbol, date) {
        return `${symbol}:${date}`;
    }
    upsert(bar) {
        this.prices.set(this.key(bar.symbol, bar.barDate), bar);
        const currentLatest = this.latestBySymbol.get(bar.symbol);
        if (!currentLatest || bar.barDate > currentLatest) {
            this.latestBySymbol.set(bar.symbol, bar.barDate);
        }
    }
    get(symbol, barDate) {
        return this.prices.get(this.key(symbol, barDate));
    }
    listBySymbol(symbol, limit = 252) {
        return Array.from(this.prices.values())
            .filter(p => p.symbol === symbol)
            .sort((a, b) => b.barDate.localeCompare(a.barDate))
            .slice(0, limit);
    }
    listByDateRange(symbol, fromDate, toDate) {
        return Array.from(this.prices.values())
            .filter(p => p.symbol === symbol && p.barDate >= fromDate && p.barDate <= toDate)
            .sort((a, b) => a.barDate.localeCompare(b.barDate));
    }
    getLatest(symbol) {
        const latestDate = this.latestBySymbol.get(symbol);
        if (!latestDate)
            return undefined;
        return this.prices.get(this.key(symbol, latestDate));
    }
    clear() {
        this.prices.clear();
        this.latestBySymbol.clear();
    }
    /** Set the "current" date for getLatest - used in backtesting */
    setCurrentDate(date) {
        // Update latestBySymbol to only consider dates <= current date
        for (const [symbol] of this.latestBySymbol) {
            const bars = Array.from(this.prices.values())
                .filter(p => p.symbol === symbol && p.barDate <= date)
                .sort((a, b) => b.barDate.localeCompare(a.barDate));
            if (bars.length > 0) {
                this.latestBySymbol.set(symbol, bars[0].barDate);
            }
        }
    }
}
// ── Watchlist ─────────────────────────────────────────────────────────────────
export class MockWatchlistRepo {
    watchlist = new Map();
    removals = new Set();
    list() {
        return Array.from(this.watchlist.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
    get(symbol) {
        return this.watchlist.get(symbol.toUpperCase());
    }
    upsert(row) {
        this.watchlist.set(row.symbol.toUpperCase(), row);
    }
    remove(symbol) {
        this.watchlist.delete(symbol.toUpperCase());
    }
    addSymbol(symbol, note = null) {
        const normalized = symbol.toUpperCase();
        this.removals.delete(normalized);
        const existing = this.watchlist.get(normalized);
        if (existing)
            return existing;
        const row = { symbol: normalized, enabled: true, note, addedAt: Date.now() };
        this.watchlist.set(normalized, row);
        return row;
    }
    removeSymbol(symbol) {
        const normalized = symbol.toUpperCase();
        const existed = this.watchlist.has(normalized);
        this.watchlist.delete(normalized);
        if (existed)
            this.removals.add(normalized);
        return existed;
    }
    enableSymbol(symbol) {
        const row = this.watchlist.get(symbol.toUpperCase());
        if (!row)
            return false;
        row.enabled = true;
        return true;
    }
    disableSymbol(symbol) {
        const row = this.watchlist.get(symbol.toUpperCase());
        if (!row)
            return false;
        row.enabled = false;
        return true;
    }
    clear() {
        this.watchlist.clear();
        this.removals.clear();
    }
}
// ── Orders ────────────────────────────────────────────────────────────────────
export class MockOrdersRepo {
    orders = new Map();
    create(order) {
        const id = randomUUID();
        const fullOrder = { ...order, id, updatedAt: order.submittedAt };
        this.orders.set(id, fullOrder);
        return id;
    }
    get(id) {
        return this.orders.get(id);
    }
    getByClientOrderId(clientOrderId) {
        return Array.from(this.orders.values()).find(o => o.clientOrderId === clientOrderId);
    }
    listByRun(runId) {
        return Array.from(this.orders.values())
            .filter(o => o.runId === runId)
            .sort((a, b) => a.submittedAt - b.submittedAt);
    }
    updateStatus(id, status, brokerOrderId, rejectReason) {
        const order = this.orders.get(id);
        if (!order)
            return;
        order.status = status;
        if (brokerOrderId)
            order.brokerOrderId = brokerOrderId;
        if (rejectReason)
            order.rejectReason = rejectReason;
        order.updatedAt = Date.now();
    }
    listPending(symbol) {
        const pendingStatuses = ['pending', 'accepted', 'partially_filled'];
        return Array.from(this.orders.values())
            .filter(o => pendingStatuses.includes(o.status) && (!symbol || o.symbol === symbol))
            .sort((a, b) => a.submittedAt - b.submittedAt);
    }
    list(filter) {
        let orders = Array.from(this.orders.values());
        if (filter?.status) {
            orders = orders.filter(o => filter.status.includes(o.status));
        }
        if (filter?.since !== undefined) {
            orders = orders.filter(o => o.submittedAt >= filter.since);
        }
        return orders.sort((a, b) => b.submittedAt - a.submittedAt);
    }
    clear() {
        this.orders.clear();
    }
}
//# sourceMappingURL=mockRepos.js.map