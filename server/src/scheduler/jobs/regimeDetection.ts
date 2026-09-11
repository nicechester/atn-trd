/**
 * Regime Detection Job
 * Detects market regime from macro indicators (VIX, yield curve, credit spreads, sentiment).
 */

import type Database from 'better-sqlite3';
import { isTradingDay } from '../marketCalendar.js';
import { logger } from '../../lib/logger.js';
import { detectRegime, type RegimeResult } from '../../services/regimeDetectionService.js';
import { MarketRegimeRepo } from '../../repos/marketRegimeRepo.js';
import { RunsRepo, type RunTrigger } from '../../repos/runsRepo.js';
import { dataSourceRegistry } from '../../datasources/registry.js';
import type { MacroDataSource } from '../../datasources/macro/index.js';
import { getSettings } from '../../config/settingsService.js';

const log = logger.child({ component: 'regime-detection-job' });

export interface RegimeDetectionSummary {
  regime: string;
  riskScore: number;
  indicators: {
    vix: number | null;
    yieldCurve: number | null;
    breadth: number | null;
    creditSpread: number | null;
    consumerSentiment: number | null;
  };
  confirmedStreak: number;
}

export async function runRegimeDetectionJob(
  db: Database.Database,
  trigger: RunTrigger = 'regime_detection'
): Promise<RegimeDetectionSummary> {
  const now = new Date();
  const settings = getSettings();
  const runsRepo = new RunsRepo(db);

  const summary: RegimeDetectionSummary = {
    regime: 'RISK_ON',
    riskScore: 0,
    indicators: {
      vix: null,
      yieldCurve: null,
      breadth: null,
      creditSpread: null,
      consumerSentiment: null,
    },
    confirmedStreak: 0,
  };

  const runId = runsRepo.create({
    trigger,
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
    if (!isTradingDay(now) && trigger !== 'manual') {
      runsRepo.setSkipped(runId, 'not a trading day');
      return summary;
    }

    if (!settings.regime.enabled) {
      runsRepo.setSkipped(runId, 'regime detection disabled');
      return summary;
    }

    const marketRegimeRepo = new MarketRegimeRepo(db);
    const macroSource = dataSourceRegistry.get('macro') as unknown as MacroDataSource;

    const result: RegimeResult = await detectRegime({
      marketRegimeRepo,
      macroSource,
      getSettings,
    });

    summary.regime = result.regime;
    summary.riskScore = result.riskScore;
    summary.indicators = result.indicators;
    summary.confirmedStreak = result.confirmedStreak;

    runsRepo.updateStatus(runId, 'succeeded');
    runsRepo.updateSummary(runId, JSON.stringify(summary));

    log.info('regime detection job complete', {
      regime: result.regime,
      riskScore: result.riskScore,
      confirmedStreak: result.confirmedStreak,
    });

    return summary;
  } catch (err) {
    runsRepo.updateStatus(runId, 'failed', err instanceof Error ? err.message : String(err));
    log.error('regime detection job failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
