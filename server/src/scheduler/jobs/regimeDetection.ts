/**
 * Daily regime detection job.
 * Runs on trading days to detect market regime (RISK_ON / RISK_OFF / NEUTRAL).
 */

import type Database from 'better-sqlite3';
import { isTradingDay } from '../marketCalendar.js';
import { logger } from '../../lib/logger.js';
import { detectRegime } from '../../services/regimeDetectionService.js';
import { MarketRegimeRepo } from '../../repos/marketRegimeRepo.js';
import { RunsRepo } from '../../repos/runsRepo.js';
import { dataSourceRegistry } from '../../datasources/registry.js';
import type { MacroDataSource } from '../../datasources/macro/index.js';
import { getSettings } from '../../config/settingsService.js';

const log = logger.child({ component: 'regime-detection-job' });

export async function runRegimeDetectionJob(db: Database.Database): Promise<void> {
  const now = new Date();
  const runsRepo = new RunsRepo(db);

  if (!isTradingDay(now)) {
    const runId = runsRepo.create({
      trigger: 'regime_detection',
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

  const settings = getSettings();
  if (!settings.regime.enabled) {
    const runId = runsRepo.create({
      trigger: 'regime_detection',
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      model: null,
      settingsSnapshot: JSON.stringify(settings),
      error: null,
      tokenUsageJson: null,
      skipReason: null,
      summaryJson: null,
    });
    runsRepo.setSkipped(runId, 'regime detection disabled');
    return;
  }

  const runId = runsRepo.create({
    trigger: 'regime_detection',
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    model: null,
    settingsSnapshot: JSON.stringify(settings),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null,
  });

  try {
    const marketRegimeRepo = new MarketRegimeRepo(db);
    const macroSource = dataSourceRegistry.get('macro') as unknown as MacroDataSource;

    const result = await detectRegime({
      marketRegimeRepo,
      macroSource,
      getSettings,
    });

    log.info('regime detection job complete', {
      regime: result.regime,
      riskScore: result.riskScore,
      confirmedStreak: result.confirmedStreak,
    });

    runsRepo.updateStatus(runId, 'succeeded');
  } catch (err) {
    runsRepo.updateStatus(runId, 'failed', err instanceof Error ? err.message : String(err));
    log.error('regime detection job failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
