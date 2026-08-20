import type Database from 'better-sqlite3';
import { isTradingDay } from '../marketCalendar.js';
import { logger } from '../../lib/logger.js';
import { SnapshotServiceImpl } from '../../services/snapshotService.js';
import { PortfolioServiceImpl } from '../../services/portfolioService.js';
import { PriceService } from '../../services/priceService.js';
import { PositionsRepo } from '../../repos/positionsRepo.js';
import { PortfolioRepo } from '../../repos/portfolioRepo.js';
import { PricesRepo } from '../../repos/pricesRepo.js';
import { SnapshotsRepo } from '../../repos/snapshotsRepo.js';

const log = logger.child({ component: 'snapshot-job' });

/**
 * Run the daily snapshot capture job.
 * Captures portfolio + SPY benchmark at market close (16:45 ET).
 * Skips non-trading days.
 */
export async function runSnapshotJob(db: Database.Database): Promise<void> {
  const now = new Date();

  // Skip on non-trading days
  if (!isTradingDay(now)) {
    log.info('not a trading day, skipping snapshot job');
    return;
  }

  try {
    // Wire up repos and services
    const positionsRepo = new PositionsRepo(db);
    const portfolioRepo = new PortfolioRepo(db);
    const pricesRepo = new PricesRepo(db);
    const snapshotsRepo = new SnapshotsRepo(db);

    // Create price service with in-app PriceService
    const priceService = new PriceService(pricesRepo);

    // Create portfolio service
    const portfolioService = new PortfolioServiceImpl(db, priceService, positionsRepo, portfolioRepo);

    // Create snapshot service
    const snapshotService = new SnapshotServiceImpl(
      priceService,
      portfolioService,
      portfolioRepo,
      snapshotsRepo
    );

    // Capture snapshot
    const result = await snapshotService.captureSnapshot();

    if (result.status === 'ok') {
      log.info('snapshot job succeeded', {
        portfolioSnapshotId: result.portfolioSnapshotId,
        benchmarkSnapshotId: result.benchmarkSnapshotId,
      });
    } else if (result.status === 'skipped') {
      log.info('snapshot job skipped', { reason: result.reason });
    }
  } catch (err) {
    // Log error but don't throw - snapshot failures are non-critical
    log.warn('snapshot job failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
