/**
 * Backtest Replay Module
 * 
 * Provides infrastructure for replaying actual production jobs against historical data.
 */

// Repository interfaces
export type {
  ISignalSnapshotsRepo,
  IStrategicPlansRepo,
  IPlanTranchesRepo,
  IMarketRegimeRepo,
  IPortfolioRepo,
  IPositionsRepo,
  IPricesRepo,
  IWatchlistRepo,
  IOrdersRepo,
} from './repos/interfaces.js';

// Mock implementations
export {
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

// State container
export { BacktestState, type BacktestStateConfig } from './BacktestState.js';

// Replay runner
export {
  runReplay,
  type BacktestDataProvider,
  type ReplayRunnerConfig,
  type ReplayResult,
} from './replayRunner.js';
