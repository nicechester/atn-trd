import type Database from 'better-sqlite3';
export interface BacktestRunRow {
    id: string;
    name: string | null;
    startDate: string;
    endDate: string;
    symbols: string[];
    settingsSnapshot: string;
    status: 'running' | 'succeeded' | 'failed';
    progress: string | null;
    startedAt: number;
    finishedAt: number | null;
    error: string | null;
    analysis: string | null;
}
export interface BacktestSnapshotRow {
    id: string;
    backtestId: string;
    asOfDate: string;
    cashCents: number;
    positions: Array<{
        symbol: string;
        qty: number;
        avgCostCents: number;
    }>;
    totalValueCents: number;
    benchmarkValueCents: number | null;
}
export interface BacktestTradeRow {
    id: string;
    backtestId: string;
    tradeDate: string;
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    priceCents: number;
    rationale: string | null;
}
export interface BacktestMetricsRow {
    backtestId: string;
    totalReturn: number;
    benchmarkReturn: number;
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    maxDrawdown: number;
    winRate: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    totalTrades: number;
    perSymbol: Record<string, {
        return: number | null;
        trades: number;
        costBasis: number;
        proceeds: number;
    }> | null;
}
export declare class BacktestRepo {
    private readonly db;
    constructor(db: Database.Database);
    createRun(input: {
        name?: string;
        startDate: string;
        endDate: string;
        symbols: string[];
        settingsSnapshot: string;
    }): string;
    updateRunStatus(id: string, status: 'succeeded' | 'failed', error?: string): void;
    updateProgress(id: string, progress: string): void;
    updateSettingsSnapshot(id: string, settingsSnapshot: string): void;
    getRun(id: string): BacktestRunRow | null;
    listRuns(limit?: number): BacktestRunRow[];
    createSnapshot(input: {
        backtestId: string;
        asOfDate: string;
        cashCents: number;
        positions: Array<{
            symbol: string;
            qty: number;
            avgCostCents: number;
        }>;
        totalValueCents: number;
        benchmarkValueCents?: number;
    }): string;
    getSnapshots(backtestId: string): BacktestSnapshotRow[];
    createTrade(input: {
        backtestId: string;
        tradeDate: string;
        symbol: string;
        side: 'buy' | 'sell';
        qty: number;
        priceCents: number;
        rationale?: string;
    }): string;
    getTrades(backtestId: string): BacktestTradeRow[];
    saveMetrics(metrics: BacktestMetricsRow): void;
    getMetrics(backtestId: string): BacktestMetricsRow | null;
    updateAnalysis(id: string, analysis: string): void;
}
//# sourceMappingURL=backtestRepo.d.ts.map