/**
 * Daily regime detection job.
 * Runs on trading days to detect market regime (RISK_ON / RISK_OFF / NEUTRAL).
 */

import type Database from 'better-sqlite3';
import { isTradingDay } from '../marketCalendar.js';
import { logger } from '../../lib/logger.js';
import { detectRegime } from '../../services/regimeDetectionService.js';
import { MarketRegimeRepo } from '../../repos/marketRegimeRepo.js';
import { dataSourceRegistry } from '../../datasources/registry.js';
import type { MacroDataSource } from '../../datasources/macro/index.js';
import { getSettings } from '../../config/settingsService.js';

const log = logger.child({ component: 'regime-detection-job' });

export async function runRegimeDetectionJob(db: Database.Database): Promise<void> {
  const now = new Date();

  if (!isTradingDay(now)) {
    log.info('not a trading day, skipping regime detection');
    return;
  }

  const settings = getSettings();
  if (!settings.regime.enabled) {
    log.info('regime detection disabled in settings');
    return;
  }

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
  } catch (err) {
    log.error('regime detection job failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
