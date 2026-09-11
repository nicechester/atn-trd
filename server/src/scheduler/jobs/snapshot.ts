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
import { CalibrationRepo } from '../../repos/calibrationRepo.js';
import { RunsRepo } from '../../repos/runsRepo.js';
import { AlpacaBroker } from '../../brokers/alpacaBroker.js';

const log = logger.child({ component: 'snapshot-job' });

function computeCorrectDirection(direction: string, return5d: number): number {
  if (direction === 'long') return return5d > 0 ? 1 : 0;
  if (direction === 'short') return return5d < 0 ? 1 : 0;
  return Math.abs(return5d) < 0.02 ? 1 : 0;
}

/**
 * Run the daily snapshot capture job.
 * Captures portfolio + SPY benchmark at market close (16:45 ET).
 * Skips non-trading days.
 */
export async function runSnapshotJob(db: Database.Database): Promise<void> {
  const now = new Date();
  const runsRepo = new RunsRepo(db);

  if (!isTradingDay(now)) {
    const runId = runsRepo.create({
      trigger: 'snapshot',
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      model: null,
      settingsSnapshot: JSON.stringify({}),
      error: null,
      tokenUsageJson: null,
      skipReason: null,
      summaryJson: null,
    });
    runsRepo.setSkipped(runId, 'not a trading day');
    return;
  }

  const runId = runsRepo.create({
    trigger: 'snapshot',
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    model: null,
    settingsSnapshot: JSON.stringify({}),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null,
  });

  try {
    // Wire up repos and services
    const positionsRepo = new PositionsRepo(db);
    const portfolioRepo = new PortfolioRepo(db);
    const pricesRepo = new PricesRepo(db);
    const snapshotsRepo = new SnapshotsRepo(db);

    // Sync Alpaca data before snapshot
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
        const alpacaAccount = await broker.getAccount();
        const alpacaPositions = await broker.getPositions();

        // Update local portfolio with Alpaca data
        const currentPortfolio = portfolioRepo.read();
        if (currentPortfolio) {
          portfolioRepo.write({
            ...currentPortfolio,
            cashCents: alpacaAccount.cashCents,
          });
        }

        // Sync positions
        const alpacaSymbols = new Set(alpacaPositions.map(p => p.symbol));
        const localPositions = positionsRepo.listAll();
        for (const localPos of localPositions) {
          if (!alpacaSymbols.has(localPos.symbol) && localPos.qty !== 0) {
            positionsRepo.upsert({ ...localPos, qty: 0, updatedAt: Date.now() });
          }
        }
        for (const pos of alpacaPositions) {
          const existing = positionsRepo.get(pos.symbol);
          positionsRepo.upsert({
            symbol: pos.symbol,
            qty: pos.qty,
            avgCostCents: pos.avgCostCents,
            realizedPnlCents: existing?.realizedPnlCents ?? 0,
            openedAt: existing?.openedAt ?? Date.now(),
            updatedAt: Date.now(),
          });
        }
      } catch (err) {
        log.warn('failed to sync Alpaca data for snapshot', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

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
      runsRepo.setSkipped(runId, result.reason || 'skipped');
      return;
    }

    // Backfill pending calibration rows
    try {
      const calibrationRepo = new CalibrationRepo(db);
      const pending = calibrationRepo.listPendingActuals();

      for (const row of pending) {
        const assessmentDate = new Date(row.createdAt).toISOString().split('T')[0];
        const toDate = new Date(row.createdAt + 42 * 24 * 60 * 60 * 1000)
          .toISOString().split('T')[0];

        const bars = pricesRepo.listByDateRange(row.symbol, assessmentDate, toDate);
        if (bars.length < 6) continue;

        const entry = bars[0].adjCloseCents;
        if (entry === 0) continue;

        const return5d = (bars[5].adjCloseCents - entry) / entry;
        const return20d = bars.length >= 21
          ? (bars[20].adjCloseCents - entry) / entry
          : null;

        const correctDirection = computeCorrectDirection(row.predictedDirection, return5d);
        calibrationRepo.updateActuals(row.id, return5d, return20d, correctDirection);
      }
    } catch (err) {
      log.warn('calibration backfill failed', { error: err instanceof Error ? err.message : String(err) });
    }

    runsRepo.updateStatus(runId, 'succeeded');
  } catch (err) {
    runsRepo.updateStatus(runId, 'failed', err instanceof Error ? err.message : String(err));
    log.warn('snapshot job failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
