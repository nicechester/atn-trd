import type { PriceFeed } from './priceService.js';
import type { PortfolioService } from './portfolioService.js';
import type { PortfolioRepo } from '../repos/portfolioRepo.js';
import type { SnapshotsRepo } from '../repos/snapshotsRepo.js';
/**
 * Result of a snapshot capture operation.
 */
export type SnapshotResult = {
    status: 'ok';
    portfolioSnapshotId: string;
    benchmarkSnapshotId: string | null;
} | {
    status: 'skipped';
    reason: 'portfolio_not_initialized';
};
/**
 * Service for capturing daily portfolio and benchmark snapshots at market close.
 */
export interface SnapshotService {
    /**
     * Capture current portfolio and benchmark (SPY) snapshots.
     * Returns ok on success or skipped if portfolio not initialized.
     */
    captureSnapshot(): Promise<SnapshotResult>;
}
export declare class SnapshotServiceImpl implements SnapshotService {
    private readonly priceFeed;
    private readonly portfolioService;
    private readonly portfolioRepo;
    private readonly snapshotsRepo;
    constructor(priceFeed: PriceFeed, portfolioService: PortfolioService, portfolioRepo: PortfolioRepo, snapshotsRepo: SnapshotsRepo);
    captureSnapshot(): Promise<SnapshotResult>;
    /**
     * Capture SPY benchmark price for the given date.
     * Never throws - returns null if SPY fetch fails.
     */
    private captureBenchmark;
}
//# sourceMappingURL=snapshotService.d.ts.map