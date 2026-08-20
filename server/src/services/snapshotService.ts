import type { PriceFeed } from './priceService.js';
import type { PortfolioService } from './portfolioService.js';
import type { PortfolioRepo } from '../repos/portfolioRepo.js';
import type { SnapshotsRepo } from '../repos/snapshotsRepo.js';
import { toETDateStr } from '../scheduler/marketCalendar.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'snapshot-service' });

/**
 * Result of a snapshot capture operation.
 */
export type SnapshotResult =
  | { status: 'ok'; portfolioSnapshotId: string; benchmarkSnapshotId: string | null }
  | { status: 'skipped'; reason: 'portfolio_not_initialized' };

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

export class SnapshotServiceImpl implements SnapshotService {
  constructor(
    private readonly priceFeed: PriceFeed,
    private readonly portfolioService: PortfolioService,
    private readonly portfolioRepo: PortfolioRepo,
    private readonly snapshotsRepo: SnapshotsRepo
  ) {}

  async captureSnapshot(): Promise<SnapshotResult> {
    // Check if portfolio is initialized
    const portfolio = this.portfolioRepo.read();
    if (!portfolio) {
      log.info('portfolio not initialized, skipping snapshot');
      return { status: 'skipped', reason: 'portfolio_not_initialized' };
    }

    const asOfDate = toETDateStr(new Date());

    try {
      // Get live portfolio state
      const portfolioState = await this.portfolioService.getPortfolio();

      // Build weights array for positions
      interface PositionWeight {
        symbol: string;
        weightPercent: number;
      }
      const weights: PositionWeight[] = portfolioState.positions.map((pos) => ({
        symbol: pos.symbol,
        weightPercent: pos.weightPercent,
      }));

      // Capture portfolio snapshot with new fields
      const portfolioSnapshotId = this.snapshotsRepo.upsertPortfolioSnapshot({
        asOfDate,
        cashCents: portfolioState.cashCents,
        positionsValueCents: portfolioState.positionsValueCents,
        totalValueCents: portfolioState.totalValueCents,
        unrealizedPnlCents: portfolioState.totalUnrealizedPnlCents,
        weightsJson: weights.length > 0 ? JSON.stringify(weights) : '[]',
      });

      // Capture benchmark (SPY) snapshot
      const benchmarkSnapshotId = await this.captureBenchmark(asOfDate);

      log.info('snapshot captured successfully', {
        asOfDate,
        portfolioSnapshotId,
        benchmarkSnapshotId,
        totalValueCents: portfolioState.totalValueCents,
        unrealizedPnlCents: portfolioState.totalUnrealizedPnlCents,
        positionCount: portfolioState.positions.length,
      });

      return {
        status: 'ok',
        portfolioSnapshotId,
        benchmarkSnapshotId,
      };
    } catch (err) {
      log.error('failed to capture portfolio snapshot', {
        asOfDate,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Capture SPY benchmark price for the given date.
   * Never throws - returns null if SPY fetch fails.
   */
  private async captureBenchmark(asOfDate: string): Promise<string | null> {
    try {
      // Try to get SPY price first
      const price = await this.priceFeed.getPrice('SPY');
      if (price !== null && price !== undefined) {
        const priceCents = Math.round(price * 100);
        this.snapshotsRepo.upsertBenchmarkSnapshot({
          symbol: 'SPY',
          asOfDate,
          closeCents: priceCents,
          adjCloseCents: priceCents,
        });
        return asOfDate;
      }

      // Fallback to latest bar
      const bar = await this.priceFeed.getLatestBar('SPY');
      if (bar) {
        this.snapshotsRepo.upsertBenchmarkSnapshot({
          symbol: 'SPY',
          asOfDate,
          closeCents: bar.closeCents,
          adjCloseCents: bar.adjCloseCents,
        });
        return asOfDate;
      }

      log.warn('SPY benchmark not available', { asOfDate });
      return null;
    } catch (err) {
      log.warn('failed to capture SPY benchmark', {
        asOfDate,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
