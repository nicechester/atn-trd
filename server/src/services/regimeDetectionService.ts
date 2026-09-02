/**
 * Market Regime Detection Service
 *
 * Detects market regime (RISK_ON / RISK_OFF / NEUTRAL) based on macro indicators.
 * Used to determine whether to execute equity accumulation or rotate to defensive assets.
 */

import { randomUUID } from 'crypto';
import type { Settings } from '@atn-trd/shared';
import { logger } from '../lib/logger.js';
import type { MarketRegimeRepo, MarketRegimeRow, Regime } from '../repos/marketRegimeRepo.js';
import type { MacroDataSource } from '../datasources/macro/index.js';

const log = logger.child({ component: 'regime-detection' });

export interface RegimeIndicators {
  vix: number | null;
  yieldCurve: number | null;  // 10Y - 2Y spread
  breadth: number | null;     // % stocks above 200 SMA (0-1)
}

export interface RegimeDetectionDeps {
  marketRegimeRepo: MarketRegimeRepo;
  macroSource: MacroDataSource;
  getSettings: () => Settings;
}

export interface RegimeResult {
  regime: Regime;
  riskScore: number;
  indicators: RegimeIndicators;
  confirmedStreak: number;
}

/**
 * Compute risk score from indicators.
 * Higher score = more risk-off signals.
 */
function computeRiskScore(indicators: RegimeIndicators, settings: Settings): number {
  const { regime: regimeSettings } = settings;
  let score = 0;

  if (indicators.vix !== null) {
    if (indicators.vix > regimeSettings.vixExtremeThreshold) {
      score += 0.50;  // VIX extreme (>35 default)
    } else if (indicators.vix > regimeSettings.vixRiskOffThreshold) {
      score += 0.30;  // VIX elevated (>25 default)
    }
  }

  if (indicators.yieldCurve !== null && regimeSettings.yieldCurveEnabled) {
    if (indicators.yieldCurve < 0) {
      score += 0.25;  // Inverted yield curve
    }
  }

  if (indicators.breadth !== null) {
    if (indicators.breadth < regimeSettings.breadthThreshold) {
      score += 0.25;  // Poor market breadth (<40% default)
    }
  }

  return Math.min(1, score);
}

/**
 * Determine regime from risk score.
 */
function scoreToRegime(riskScore: number): Regime {
  if (riskScore >= 0.50) return 'RISK_OFF';
  if (riskScore >= 0.25) return 'NEUTRAL';
  return 'RISK_ON';
}

/**
 * Fetch current macro indicators from data sources.
 */
async function fetchIndicators(macroSource: MacroDataSource): Promise<RegimeIndicators> {
  const indicators: RegimeIndicators = {
    vix: null,
    yieldCurve: null,
    breadth: null,
  };

  try {
    const result = await macroSource.fetch({ seriesIds: ['VIXCLS', 'T10Y2Y'] });

    for (const series of result.data.series) {
      if (series.seriesId === 'VIXCLS' && series.latest) {
        indicators.vix = series.latest.value;
      }
      if (series.seriesId === 'T10Y2Y' && series.latest) {
        indicators.yieldCurve = series.latest.value;
      }
    }
  } catch (err) {
    log.warn('failed to fetch macro indicators', { error: err instanceof Error ? err.message : String(err) });
  }

  // Note: breadth requires computing % of stocks above 200 SMA
  // This would need price data for a broad index - leaving null for now
  // Could be added later with SPY constituents data

  return indicators;
}

/**
 * Detect current market regime and persist to database.
 */
export async function detectRegime(deps: RegimeDetectionDeps): Promise<RegimeResult> {
  const { marketRegimeRepo, macroSource, getSettings } = deps;
  const settings = getSettings();

  if (!settings.regime.enabled) {
    log.info('regime detection disabled');
    return {
      regime: 'RISK_ON',
      riskScore: 0,
      indicators: { vix: null, yieldCurve: null, breadth: null },
      confirmedStreak: 0,
    };
  }

  const asOfDate = new Date().toISOString().split('T')[0];
  const indicators = await fetchIndicators(macroSource);
  const riskScore = computeRiskScore(indicators, settings);
  const regime = scoreToRegime(riskScore);

  // Persist
  const row: MarketRegimeRow = {
    id: randomUUID(),
    asOfDate,
    regime,
    vixLevel: indicators.vix,
    yieldCurveSpread: indicators.yieldCurve,
    breadthPct: indicators.breadth,
    riskScore,
    indicatorsJson: JSON.stringify(indicators),
    createdAt: Date.now(),
  };

  marketRegimeRepo.upsert(row);

  // Check streak for confirmation
  const confirmedStreak = marketRegimeRepo.getRegimeStreak(regime);

  log.info('regime detected', { asOfDate, regime, riskScore, confirmedStreak, indicators });

  return { regime, riskScore, indicators, confirmedStreak };
}

/**
 * Check if plans should be paused based on regime confirmation.
 */
export function shouldPausePlans(deps: RegimeDetectionDeps): boolean {
  const { marketRegimeRepo, getSettings } = deps;
  const settings = getSettings();

  if (!settings.regime.enabled) return false;

  const streak = marketRegimeRepo.getRegimeStreak('RISK_OFF');
  return streak >= settings.regime.confirmationDays;
}

/**
 * Get current regime (from latest stored value).
 */
export function getCurrentRegime(marketRegimeRepo: MarketRegimeRepo): Regime {
  const latest = marketRegimeRepo.getLatest();
  return latest?.regime ?? 'RISK_ON';
}
