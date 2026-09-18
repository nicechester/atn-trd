/**
 * In-memory mock implementations of repositories for backtesting.
 * Uses Maps/Arrays instead of SQLite for fast, isolated execution.
 */

import { randomUUID } from 'crypto';
import type {
  ISignalSnapshotsRepo,
  IStrategicPlansRepo,
  IPlanTranchesRepo,
  IMarketRegimeRepo,
  IPortfolioRepo,
  IPositionsRepo,
  IPricesRepo,
  IWatchlistRepo,
  IOrdersRepo,
  SignalSnapshotRow,
  StrategicPlanRow,
  PlanStatus,
  PlanTrancheRow,
  TrancheStatus,
  MarketRegimeRow,
  Regime,
  PortfolioRow,
  PositionRow,
  PriceBarRow,
  WatchlistRow,
  OrderRow,
} from './interfaces.js';

// ── Signal Snapshots ──────────────────────────────────────────────────────────

export class MockSignalSnapshotsRepo implements ISignalSnapshotsRepo {
  private snapshots = new Map<string, SignalSnapshotRow>(); // key: symbol:date

  private key(symbol: string, date: string): string {
    return `${symbol}:${date}`;
  }

  insert(row: SignalSnapshotRow): boolean {
    const k = this.key(row.symbol, row.snapshotDate);
    if (this.snapshots.has(k)) return false;
    this.snapshots.set(k, row);
    return true;
  }

  get(symbol: string, snapshotDate: string): SignalSnapshotRow | undefined {
    return this.snapshots.get(this.key(symbol, snapshotDate));
  }

  getLatest(symbol: string): SignalSnapshotRow | undefined {
    const symbolSnapshots = Array.from(this.snapshots.values())
      .filter(s => s.symbol === symbol)
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
    return symbolSnapshots[0];
  }

  listBySymbol(symbol: string, limit = 30): SignalSnapshotRow[] {
    return Array.from(this.snapshots.values())
      .filter(s => s.symbol === symbol)
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))
      .slice(0, limit);
  }

  getRecentSnapshots(symbol: string, days: number): SignalSnapshotRow[] {
    return this.listBySymbol(symbol, days);
  }

  getRecentSentiment(symbol: string, days: number): Array<{ snapshotDate: string; sentimentScore: number }> {
    return this.listBySymbol(symbol, days)
      .filter(s => s.sentimentScore !== null)
      .map(s => ({ snapshotDate: s.snapshotDate, sentimentScore: s.sentimentScore! }));
  }

  clear(): void {
    this.snapshots.clear();
  }
}

// ── Strategic Plans ───────────────────────────────────────────────────────────

export class MockStrategicPlansRepo implements IStrategicPlansRepo {
  private plans = new Map<string, StrategicPlanRow>();

  create(plan: Omit<StrategicPlanRow, 'executedShares' | 'tranchesExecuted' | 'lastTrancheAt' | 'completedAt'>): void {
    const fullPlan: StrategicPlanRow = {
      ...plan,
      executedShares: 0,
      tranchesExecuted: 0,
      lastTrancheAt: null,
      completedAt: null,
    };
    this.plans.set(plan.id, fullPlan);
  }

  get(id: string): StrategicPlanRow | undefined {
    return this.plans.get(id);
  }

  getActiveBySymbol(symbol: string): StrategicPlanRow | undefined {
    return Array.from(this.plans.values()).find(p => p.symbol === symbol && p.status === 'ACTIVE');
  }

  listActive(): StrategicPlanRow[] {
    return Array.from(this.plans.values())
      .filter(p => p.status === 'ACTIVE')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  listPaused(): StrategicPlanRow[] {
    return Array.from(this.plans.values())
      .filter(p => p.status === 'PAUSED')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  listBySymbol(symbol: string): StrategicPlanRow[] {
    return Array.from(this.plans.values())
      .filter(p => p.symbol === symbol)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  updateStatus(id: string, status: PlanStatus, pauseReason?: string): void {
    const plan = this.plans.get(id);
    if (!plan) return;
    plan.status = status;
    plan.pauseReason = pauseReason ?? null;
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      plan.completedAt = Date.now();
    }
  }

  recordTrancheExecution(id: string, shares: number, timestamp?: number): void {
    const plan = this.plans.get(id);
    if (!plan) return;
    plan.executedShares += shares;
    plan.tranchesExecuted += 1;
    plan.lastTrancheAt = timestamp ?? Date.now();
  }

  clear(): void {
    this.plans.clear();
  }
}

// ── Plan Tranches ─────────────────────────────────────────────────────────────

export class MockPlanTranchesRepo implements IPlanTranchesRepo {
  private tranches = new Map<string, PlanTrancheRow>();

  create(tranche: Omit<PlanTrancheRow, 'orderStatus' | 'totalCostCents' | 'filledAt'>): void {
    const fullTranche: PlanTrancheRow = {
      ...tranche,
      orderStatus: 'PENDING',
      totalCostCents: null,
      filledAt: null,
    };
    this.tranches.set(tranche.id, fullTranche);
  }

  listByPlan(planId: string): PlanTrancheRow[] {
    return Array.from(this.tranches.values())
      .filter(t => t.planId === planId)
      .sort((a, b) => a.trancheNumber - b.trancheNumber);
  }

  getLatestByPlan(planId: string): PlanTrancheRow | undefined {
    const planTranches = this.listByPlan(planId);
    return planTranches[planTranches.length - 1];
  }

  listPending(): PlanTrancheRow[] {
    return Array.from(this.tranches.values())
      .filter(t => t.orderStatus === 'PENDING')
      .sort((a, b) => a.executedAt - b.executedAt);
  }

  updateStatus(id: string, status: TrancheStatus, totalCostCents?: number, filledAt?: number): void {
    const tranche = this.tranches.get(id);
    if (!tranche) return;
    tranche.orderStatus = status;
    if (totalCostCents !== undefined) tranche.totalCostCents = totalCostCents;
    if (filledAt !== undefined) tranche.filledAt = filledAt;
  }

  updateShares(id: string, shares: number): void {
    const tranche = this.tranches.get(id);
    if (tranche) tranche.shares = shares;
  }

  clear(): void {
    this.tranches.clear();
  }
}

// ── Market Regime ─────────────────────────────────────────────────────────────

export class MockMarketRegimeRepo implements IMarketRegimeRepo {
  private regimes = new Map<string, MarketRegimeRow>(); // key: asOfDate

  upsert(row: MarketRegimeRow): void {
    this.regimes.set(row.asOfDate, row);
  }

  get(asOfDate: string): MarketRegimeRow | undefined {
    return this.regimes.get(asOfDate);
  }

  getLatest(): MarketRegimeRow | undefined {
    const sorted = Array.from(this.regimes.values())
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
    return sorted[0];
  }

  getRecentRegimes(days: number): MarketRegimeRow[] {
    return Array.from(this.regimes.values())
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))
      .slice(0, days);
  }

  getRegimeStreak(regime: Regime): number {
    const recent = this.getRecentRegimes(10);
    let streak = 0;
    for (const row of recent) {
      if (row.regime === regime) streak++;
      else break;
    }
    return streak;
  }

  clear(): void {
    this.regimes.clear();
  }
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

export class MockPortfolioRepo implements IPortfolioRepo {
  private portfolio: PortfolioRow | undefined;

  read(): PortfolioRow | undefined {
    return this.portfolio;
  }

  write(row: PortfolioRow): void {
    this.portfolio = row;
  }

  clear(): void {
    this.portfolio = undefined;
  }
}

// ── Positions ─────────────────────────────────────────────────────────────────

export class MockPositionsRepo implements IPositionsRepo {
  private positions = new Map<string, PositionRow>();

  upsert(position: PositionRow): void {
    this.positions.set(position.symbol, position);
  }

  get(symbol: string): PositionRow | undefined {
    return this.positions.get(symbol);
  }

  list(): PositionRow[] {
    return Array.from(this.positions.values()).filter(p => p.qty !== 0);
  }

  listAll(): PositionRow[] {
    return Array.from(this.positions.values());
  }

  remove(symbol: string): void {
    this.positions.delete(symbol);
  }

  clear(): void {
    this.positions.clear();
  }

  getTotalQtyCost(): { totalQty: number; totalCostCents: number } {
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

export class MockPricesRepo implements IPricesRepo {
  private prices = new Map<string, PriceBarRow>(); // key: symbol:date
  private latestBySymbol = new Map<string, string>(); // symbol -> latest date

  private key(symbol: string, date: string): string {
    return `${symbol}:${date}`;
  }

  upsert(bar: PriceBarRow): void {
    this.prices.set(this.key(bar.symbol, bar.barDate), bar);
    const currentLatest = this.latestBySymbol.get(bar.symbol);
    if (!currentLatest || bar.barDate > currentLatest) {
      this.latestBySymbol.set(bar.symbol, bar.barDate);
    }
  }

  get(symbol: string, barDate: string): PriceBarRow | undefined {
    return this.prices.get(this.key(symbol, barDate));
  }

  listBySymbol(symbol: string, limit = 252): PriceBarRow[] {
    return Array.from(this.prices.values())
      .filter(p => p.symbol === symbol)
      .sort((a, b) => b.barDate.localeCompare(a.barDate))
      .slice(0, limit);
  }

  listByDateRange(symbol: string, fromDate: string, toDate: string): PriceBarRow[] {
    return Array.from(this.prices.values())
      .filter(p => p.symbol === symbol && p.barDate >= fromDate && p.barDate <= toDate)
      .sort((a, b) => a.barDate.localeCompare(b.barDate));
  }

  getLatest(symbol: string): PriceBarRow | undefined {
    const latestDate = this.latestBySymbol.get(symbol);
    if (!latestDate) return undefined;
    return this.prices.get(this.key(symbol, latestDate));
  }

  clear(): void {
    this.prices.clear();
    this.latestBySymbol.clear();
  }

  /** Set the "current" date for getLatest - used in backtesting */
  setCurrentDate(date: string): void {
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

export class MockWatchlistRepo implements IWatchlistRepo {
  private watchlist = new Map<string, WatchlistRow>();
  private removals = new Set<string>();

  list(): WatchlistRow[] {
    return Array.from(this.watchlist.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  get(symbol: string): WatchlistRow | undefined {
    return this.watchlist.get(symbol.toUpperCase());
  }

  upsert(row: WatchlistRow): void {
    this.watchlist.set(row.symbol.toUpperCase(), row);
  }

  remove(symbol: string): void {
    this.watchlist.delete(symbol.toUpperCase());
  }

  addSymbol(symbol: string, note: string | null = null): WatchlistRow {
    const normalized = symbol.toUpperCase();
    this.removals.delete(normalized);
    const existing = this.watchlist.get(normalized);
    if (existing) return existing;
    const row: WatchlistRow = { symbol: normalized, enabled: true, note, addedAt: Date.now() };
    this.watchlist.set(normalized, row);
    return row;
  }

  removeSymbol(symbol: string): boolean {
    const normalized = symbol.toUpperCase();
    const existed = this.watchlist.has(normalized);
    this.watchlist.delete(normalized);
    if (existed) this.removals.add(normalized);
    return existed;
  }

  enableSymbol(symbol: string): boolean {
    const row = this.watchlist.get(symbol.toUpperCase());
    if (!row) return false;
    row.enabled = true;
    return true;
  }

  disableSymbol(symbol: string): boolean {
    const row = this.watchlist.get(symbol.toUpperCase());
    if (!row) return false;
    row.enabled = false;
    return true;
  }

  clear(): void {
    this.watchlist.clear();
    this.removals.clear();
  }
}

// ── Orders ────────────────────────────────────────────────────────────────────

export class MockOrdersRepo implements IOrdersRepo {
  private orders = new Map<string, OrderRow>();

  create(order: Omit<OrderRow, 'id' | 'updatedAt'>): string {
    const id = randomUUID();
    const fullOrder: OrderRow = { ...order, id, updatedAt: order.submittedAt };
    this.orders.set(id, fullOrder);
    return id;
  }

  get(id: string): OrderRow | undefined {
    return this.orders.get(id);
  }

  getByClientOrderId(clientOrderId: string): OrderRow | undefined {
    return Array.from(this.orders.values()).find(o => o.clientOrderId === clientOrderId);
  }

  listByRun(runId: string): OrderRow[] {
    return Array.from(this.orders.values())
      .filter(o => o.runId === runId)
      .sort((a, b) => a.submittedAt - b.submittedAt);
  }

  updateStatus(id: string, status: OrderRow['status'], brokerOrderId?: string, rejectReason?: string): void {
    const order = this.orders.get(id);
    if (!order) return;
    order.status = status;
    if (brokerOrderId) order.brokerOrderId = brokerOrderId;
    if (rejectReason) order.rejectReason = rejectReason;
    order.updatedAt = Date.now();
  }

  listPending(symbol?: string): OrderRow[] {
    const pendingStatuses = ['pending', 'accepted', 'partially_filled'];
    return Array.from(this.orders.values())
      .filter(o => pendingStatuses.includes(o.status) && (!symbol || o.symbol === symbol))
      .sort((a, b) => a.submittedAt - b.submittedAt);
  }

  list(filter?: { status?: OrderRow['status'][]; since?: number }): OrderRow[] {
    let orders = Array.from(this.orders.values());
    if (filter?.status) {
      orders = orders.filter(o => filter.status!.includes(o.status));
    }
    if (filter?.since !== undefined) {
      orders = orders.filter(o => o.submittedAt >= filter.since!);
    }
    return orders.sort((a, b) => b.submittedAt - a.submittedAt);
  }

  clear(): void {
    this.orders.clear();
  }
}
