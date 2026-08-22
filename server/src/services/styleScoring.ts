/**
 * Style-based scoring service for investment decisions.
 * Scores symbols on a scale of -1 (bearish) to +1 (bullish) based on
 * fundamental metrics, volatility, and investor style weights.
 */

import { type StyleWeights } from '@atn-trd/shared';
import { computeAnnualizedVolatility, computeTrailingReturnPercent, type Bar } from '../lib/volatility.js';

export interface Fundamentals {
  marketCap: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  peRatio: number | null;
  beta: number | null;
  dividendYield: number | null;
  fcfYield: number | null;
}

export interface VolatilityMetrics {
  annualizedVolatility: number | null;
  trailingReturnPercent: number | null;
}

/**
 * Build volatility metrics from price bars.
 */
export function buildVolatilityMetrics(bars: Bar[]): VolatilityMetrics {
  return {
    annualizedVolatility: computeAnnualizedVolatility(bars),
    trailingReturnPercent: computeTrailingReturnPercent(bars),
  };
}

/**
 * Clamp a value to [-1, 1] range.
 */
function clamp(value: number, min: number = -1, max: number = 1): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a metric to [-1, 1] range with given thresholds.
 * If value is null, returns 0 (neutral).
 */
function normalizeMetric(value: number | null, bearishThreshold: number, bullishThreshold: number): number {
  if (value === null) {
    return 0;
  }

  if (value < bearishThreshold) {
    return -1;
  }
  if (value > bullishThreshold) {
    return 1;
  }

  // Linear interpolation
  const range = bullishThreshold - bearishThreshold;
  return (value - bearishThreshold) / range * 2 - 1;
}

/**
 * Score a symbol based on fundamentals, volatility, and style weights.
 * Returns a score in [-1, 1] where -1 is very bearish and +1 is very bullish.
 */
export function scoreSymbol(
  fundamentals: Fundamentals,
  volatility: VolatilityMetrics,
  weights: StyleWeights
): number {
  // Initialize sub-scores
  let growthScore = 0;
  let valueScore = 0;
  let stabilityScore = 0;
  let cashFlowScore = 0;
  let momentumScore = 0;

  // --- Growth Score ---
  // Average of revenue growth and earnings growth
  const growthMetrics: number[] = [];
  if (fundamentals.revenueGrowth !== null && fundamentals.revenueGrowth !== undefined) {
    growthMetrics.push(fundamentals.revenueGrowth);
  }
  if (fundamentals.earningsGrowth !== null && fundamentals.earningsGrowth !== undefined) {
    growthMetrics.push(fundamentals.earningsGrowth);
  }
  if (growthMetrics.length > 0) {
    const avgGrowth = growthMetrics.reduce((a, b) => a + b, 0) / growthMetrics.length;
    // Thresholds: < 0% is bearish, > 20% is bullish
    growthScore = normalizeMetric(avgGrowth, 0, 20);
  }

  // --- Value Score (P/E) ---
  // Lower P/E is better (value play). Inverted scoring.
  if (fundamentals.peRatio !== null && fundamentals.peRatio !== undefined && fundamentals.peRatio > 0) {
    // Thresholds: P/E > 30 is bearish (expensive), P/E < 15 is bullish (cheap)
    // We invert: lower P/E = higher score
    const inverted = -normalizeMetric(fundamentals.peRatio, 30, 15);
    valueScore = clamp(inverted);
  }

  // --- Stability Score ---
  // Combines beta (lower is more stable) and volatility (lower is more stable)
  const stabilityMetrics: number[] = [];
  if (fundamentals.beta !== null && fundamentals.beta !== undefined && fundamentals.beta > 0) {
    // Invert beta: higher beta = lower score
    const betaScore = normalizeMetric(fundamentals.beta, 1.5, 0.5);
    const invertedBetaScore = -betaScore;
    stabilityMetrics.push(clamp(invertedBetaScore));
  }
  if (volatility.annualizedVolatility !== null) {
    // Lower volatility is more stable. Invert: higher volatility = lower score
    const volScore = normalizeMetric(volatility.annualizedVolatility, 0.5, 0.1);
    const invertedVolScore = -volScore;
    stabilityMetrics.push(clamp(invertedVolScore));
  }
  if (stabilityMetrics.length > 0) {
    stabilityScore = stabilityMetrics.reduce((a, b) => a + b, 0) / stabilityMetrics.length;
  }

  // --- Cash Flow Score ---
  // Combines dividend yield and FCF yield
  const cashFlowMetrics: number[] = [];
  if (fundamentals.dividendYield !== null && fundamentals.dividendYield !== undefined) {
    // Thresholds: < 1% is bearish, > 4% is bullish
    cashFlowMetrics.push(normalizeMetric(fundamentals.dividendYield, 1, 4));
  }
  if (fundamentals.fcfYield !== null && fundamentals.fcfYield !== undefined) {
    // Thresholds: < 2% is bearish, > 8% is bullish
    cashFlowMetrics.push(normalizeMetric(fundamentals.fcfYield, 2, 8));
  }
  if (cashFlowMetrics.length > 0) {
    cashFlowScore = cashFlowMetrics.reduce((a, b) => a + b, 0) / cashFlowMetrics.length;
  }

  // --- Momentum Score ---
  // Based on trailing return percent
  if (volatility.trailingReturnPercent !== null) {
    // Thresholds: < -10% is bearish, > 10% is bullish
    momentumScore = normalizeMetric(volatility.trailingReturnPercent, -10, 10);
  }

  // --- Weighted Score ---
  // Normalize weights from 0-100 to 0-1
  const w = {
    growth: weights.growth / 100,
    value: weights.value / 100,
    stability: weights.stability / 100,
    cashFlow: weights.cashFlow / 100,
    momentum: weights.momentum / 100,
  };

  const weightedScore =
    w.growth * growthScore +
    w.value * valueScore +
    w.stability * stabilityScore +
    w.cashFlow * cashFlowScore +
    w.momentum * momentumScore;

  return clamp(weightedScore);
}
