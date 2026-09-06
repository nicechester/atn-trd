/**
 * Backtest metrics calculator.
 * Computes performance statistics from backtest snapshots and trades.
 */
import type { BacktestSnapshotRow, BacktestTradeRow, BacktestMetricsRow } from '../repos/backtestRepo.js';
export interface MetricsInput {
    backtestId: string;
    snapshots: BacktestSnapshotRow[];
    trades: BacktestTradeRow[];
}
export declare function calculateMetrics(input: MetricsInput): BacktestMetricsRow;
//# sourceMappingURL=metrics.d.ts.map