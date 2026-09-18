/**
 * BacktestState: Container for all in-memory state during backtest replay.
 * Provides isolated state for each backtest run.
 */


import {
  MockSignalSnapshotsRepo,
  MockStrategicPlansRepo,
  MockPlanTranchesRepo,
  MockMarketRegimeRepo,
  MockPortfolioRepo,
  MockPositionsRepo,
  MockPricesRepo,
  MockWatchlistRepo,
  MockOrdersRepo,
} from './repos/mockRepos.js';

export interface BacktestStateConfig {
  symbols: string[];
  startingCashCents: number;
  startDate: string;
}

export interface Fill {
  date: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  priceCents: number;
}

export class BacktestState {
  readonly signalSnapshots: MockSignalSnapshotsRepo;
  readonly strategicPlans: MockStrategicPlansRepo;
  readonly planTranches: MockPlanTranchesRepo;
  readonly marketRegime: MockMarketRegimeRepo;
  readonly portfolio: MockPortfolioRepo;
  readonly positions: MockPositionsRepo;
  readonly prices: MockPricesRepo;
  readonly watchlist: MockWatchlistRepo;
  readonly orders: MockOrdersRepo;

  private currentDate: string;
  private readonly config: BacktestStateConfig;
  private readonly fills: Fill[] = [];

  constructor(config: BacktestStateConfig) {
    this.config = config;
    this.currentDate = config.startDate;

    // Initialize all mock repos
    this.signalSnapshots = new MockSignalSnapshotsRepo();
    this.strategicPlans = new MockStrategicPlansRepo();
    this.planTranches = new MockPlanTranchesRepo();
    this.marketRegime = new MockMarketRegimeRepo();
    this.portfolio = new MockPortfolioRepo();
    this.positions = new MockPositionsRepo();
    this.prices = new MockPricesRepo();
    this.watchlist = new MockWatchlistRepo();
    this.orders = new MockOrdersRepo();

    this.initializeState();
  }

  private initializeState(): void {
    // Initialize portfolio
    this.portfolio.write({
      cashCents: this.config.startingCashCents,
      startingCashCents: this.config.startingCashCents,
      startedAt: Date.now(),
      resetAt: null,
      baseCurrency: 'USD',
    });

    // Initialize watchlist with symbols
    for (const symbol of this.config.symbols) {
      this.watchlist.addSymbol(symbol);
    }
  }

  /** Set current simulation date - updates price repo's "latest" view */
  setCurrentDate(date: string): void {
    this.currentDate = date;
    this.prices.setCurrentDate(date);
  }

  getCurrentDate(): string {
    return this.currentDate;
  }

  /** Reset all state for a fresh backtest */
  reset(): void {
    this.signalSnapshots.clear();
    this.strategicPlans.clear();
    this.planTranches.clear();
    this.marketRegime.clear();
    this.portfolio.clear();
    this.positions.clear();
    this.prices.clear();
    this.watchlist.clear();
    this.orders.clear();

    this.currentDate = this.config.startDate;
    this.initializeState();
  }

  /** Get current portfolio value (cash + positions at current prices) */
  getPortfolioValueCents(): number {
    const portfolio = this.portfolio.read();
    if (!portfolio) return 0;

    let equityCents = 0;
    for (const pos of this.positions.list()) {
      const price = this.prices.getLatest(pos.symbol);
      if (price) {
        equityCents += pos.qty * price.adjCloseCents;
      }
    }

    return portfolio.cashCents + equityCents;
  }

  /** Update cash after a trade */
  updateCash(deltaCents: number): void {
    const portfolio = this.portfolio.read();
    if (!portfolio) return;
    this.portfolio.write({
      ...portfolio,
      cashCents: portfolio.cashCents + deltaCents,
    });
  }

  /** Record a position change from a fill */
  recordFill(symbol: string, side: 'buy' | 'sell', qty: number, priceCents: number): void {
    // Track fill for reporting
    this.fills.push({ date: this.currentDate, symbol, side, qty, priceCents });

    const existing = this.positions.get(symbol);
    const now = Date.now();

    if (side === 'buy') {
      if (existing) {
        const newQty = existing.qty + qty;
        const newAvgCost = Math.round(
          (existing.qty * existing.avgCostCents + qty * priceCents) / newQty
        );
        this.positions.upsert({
          ...existing,
          qty: newQty,
          avgCostCents: newAvgCost,
          updatedAt: now,
        });
      } else {
        this.positions.upsert({
          symbol,
          qty,
          avgCostCents: priceCents,
          realizedPnlCents: 0,
          openedAt: now,
          updatedAt: now,
        });
      }
      this.updateCash(-qty * priceCents);
    } else {
      if (!existing || existing.qty < qty) {
        throw new Error(`Insufficient shares to sell: ${symbol}`);
      }
      const realizedPnl = qty * (priceCents - existing.avgCostCents);
      const newQty = existing.qty - qty;

      if (newQty === 0) {
        this.positions.remove(symbol);
      } else {
        this.positions.upsert({
          ...existing,
          qty: newQty,
          realizedPnlCents: existing.realizedPnlCents + realizedPnl,
          updatedAt: now,
        });
      }
      this.updateCash(qty * priceCents);
    }
  }

  /** Get snapshot of current state */
  getStateSnapshot(): {
    date: string;
    cashCents: number;
    portfolioValueCents: number;
    positions: Array<{ symbol: string; qty: number; avgCostCents: number }>;
    positionCount: number;
    activePlanCount: number;
    regime: string | null;
    fills: Fill[];
  } {
    const portfolio = this.portfolio.read();
    const regime = this.marketRegime.getLatest();
    const positions = this.positions.list().map(p => ({
      symbol: p.symbol,
      qty: p.qty,
      avgCostCents: p.avgCostCents,
    }));

    return {
      date: this.currentDate,
      cashCents: portfolio?.cashCents ?? 0,
      portfolioValueCents: this.getPortfolioValueCents(),
      positions,
      positionCount: positions.length,
      activePlanCount: this.strategicPlans.listActive().length,
      regime: regime?.regime ?? null,
      fills: this.fills,
    };
  }
}
