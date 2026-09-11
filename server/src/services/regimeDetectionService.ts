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
  creditSpread: number | null; // High yield spread (BAMLH0A0HYM2)
  consumerSentiment: number | null; // U. Michigan sentiment
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

  // VIX contribution (0-0.30)
  if (indicators.vix !== null) {
    if (indicators.vix > regimeSettings.vixExtremeThreshold) {
      score += 0.30;  // VIX extreme (>35 default)
    } else if (indicators.vix > regimeSettings.vixRiskOffThreshold) {
      score += 0.20;  // VIX elevated (>25 default)
    }
  }

  // Yield curve contribution (0-0.20)
  if (indicators.yieldCurve !== null && regimeSettings.yieldCurveEnabled) {
    if (indicators.yieldCurve < -0.5) {
      score += 0.20;  // Deeply inverted
    } else if (indicators.yieldCurve < 0) {
      score += 0.15;  // Inverted yield curve
    }
  }

  // Credit spread contribution (0-0.25)
  // Normal HY spread ~3-4%, elevated >5%, stressed >6%
  if (indicators.creditSpread !== null) {
    if (indicators.creditSpread > 6) {
      score += 0.25;  // Credit stress
    } else if (indicators.creditSpread > 5) {
      score += 0.15;  // Elevated spreads
    }
  }

  // Consumer sentiment contribution (0-0.15)
  // Low sentiment (<60) can be contrarian bullish, but extreme lows (<50) signal real fear
  if (indicators.consumerSentiment !== null) {
    if (indicators.consumerSentiment < 50) {
      score += 0.15;  // Extreme pessimism
    } else if (indicators.consumerSentiment < 60) {
      score += 0.05;  // Below average sentiment
    }
  }

  // Breadth contribution (0-0.10)
  if (indicators.breadth !== null) {
    if (indicators.breadth < regimeSettings.breadthThreshold) {
      score += 0.10;  // Poor market breadth (<40% default)
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
    creditSpread: null,
    consumerSentiment: null,
  };

  try {
    const result = await macroSource.fetch({ seriesIds: ['VIXCLS', 'T10Y2Y', 'BAMLH0A0HYM2', 'UMCSENT'] });

    for (const series of result.data.series) {
      if (series.seriesId === 'VIXCLS' && series.latest) {
        indicators.vix = series.latest.value;
      }
      if (series.seriesId === 'T10Y2Y' && series.latest) {
        indicators.yieldCurve = series.latest.value;
      }
      if (series.seriesId === 'BAMLH0A0HYM2' && series.latest) {
        indicators.creditSpread = series.latest.value;
      }
      if (series.seriesId === 'UMCSENT' && series.latest) {
        indicators.consumerSentiment = series.latest.value;
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
      indicators: { vix: null, yieldCurve: null, breadth: null, creditSpread: null, consumerSentiment: null },
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

/**
 * Get current risk score (from latest stored value).
 * Returns 0 if no data available.
 */
export function getCurrentRiskScore(marketRegimeRepo: MarketRegimeRepo): number {
  const latest = marketRegimeRepo.getLatest();
  return latest?.riskScore ?? 0;
}

/**
 * Compute buy threshold adjustment based on macro conditions.
 * Returns a value to ADD to the base buy threshold.
 * Higher risk score = higher threshold (more selective).
 */
export function computeBuyThresholdAdjustment(riskScore: number): number {
  // At risk score 0 (healthy macro): no adjustment
  // At risk score 0.25 (neutral): +0.05 threshold
  // At risk score 0.50+ (risk-off): +0.10 threshold
  if (riskScore >= 0.50) return 0.10;
  if (riskScore >= 0.25) return 0.05;
  return 0;
}

/**
 * Compute position size multiplier based on macro conditions.
 * Returns a value between 0.5 and 1.0 to multiply base position size.
 */
export function computePositionSizeMultiplier(riskScore: number): number {
  // At risk score 0: full size (1.0)
  // At risk score 0.50+: half size (0.5)
  // Linear interpolation between
  return Math.max(0.5, 1 - riskScore);
}
