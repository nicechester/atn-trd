/**
 * Signal Collection Service
 *
 * Collects daily market signals for watchlist symbols WITHOUT making trading decisions.
 * This is the "eyes and ears" of the strategic trading system.
 */

import { randomUUID } from 'crypto';
import type { Settings } from '@atn-trd/shared';
import { logger } from '../lib/logger.js';
import type { SignalSnapshotsRepo, SignalSnapshotRow } from '../repos/signalSnapshotsRepo.js';
import type { PricesRepo, PriceBarRow } from '../repos/pricesRepo.js';
import type { WatchlistRepo } from '../repos/watchlistRepo.js';
import type { PositionsRepo } from '../repos/positionsRepo.js';
import { scoreFinBERT } from './finbertService.js';
import { synthesizeSentiment } from './signalSynthesisService.js';
import type { NewsDataSource, NewsArticle } from '../datasources/news/index.js';
import type { OptionsDataSource } from '../datasources/options/index.js';
import type { FundamentalsDataSource } from '../datasources/fundamentals/index.js';

const log = logger.child({ component: 'signal-collection' });

export interface SignalCollectionDeps {
  signalSnapshotsRepo: SignalSnapshotsRepo;
  pricesRepo: PricesRepo;
  watchlistRepo: WatchlistRepo;
  positionsRepo: PositionsRepo;
  newsSource: NewsDataSource;
  optionsSource: OptionsDataSource;
  fundamentalsSource: FundamentalsDataSource;
  getSettings: () => Settings;
}

export interface CollectionResult {
  symbol: string;
  status: 'ok' | 'skipped' | 'error';
  reason?: string;
  tokensUsed?: number;
}

/**
 * Compute linear regression slope for sentiment trend.
 * Returns slope per day (positive = improving sentiment).
 */
function computeSentimentTrend(scores: number[]): number | null {
  if (scores.length < 3) return null;

  const n = scores.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += scores[i];
    sumXY += i * scores[i];
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Compute price vs 50-day SMA as percentage.
 * Returns positive if above SMA, negative if below.
 */
function computePriceVsSma50(prices: PriceBarRow[]): number | null {
  if (prices.length < 50) return null;

  const currentPrice = prices[0].adjCloseCents;
  const sma50 = prices.slice(0, 50).reduce((sum, p) => sum + p.adjCloseCents, 0) / 50;

  if (sma50 === 0) return null;
  return (currentPrice - sma50) / sma50;
}

/**
 * Compute composite score from weighted signals.
 * Returns score in [0, 1] range where:
 *   0.0 = extremely bearish
 *   0.5 = neutral
 *   1.0 = extremely bullish
 *   0.7 = moderately bullish (typical buyThreshold)
 */
function computeCompositeScore(
  sentimentScore: number | null,
  sentimentTrend: number | null,
  priceVsSma50: number | null,
  optionsScore: number | null,
  fundamentalsScore: number | null,
  weights: { sentiment: number; sentimentTrend: number; priceMomentum: number; options: number; fundamentals: number }
): number | null {
  let score = 0;
  let totalWeight = 0;

  if (sentimentScore !== null) {
    score += weights.sentiment * sentimentScore;
    totalWeight += weights.sentiment;
  }

  if (sentimentTrend !== null) {
    // Normalize trend to -1 to 1 range (assume ±0.1 per day is extreme)
    const normalizedTrend = Math.max(-1, Math.min(1, sentimentTrend * 10));
    score += weights.sentimentTrend * normalizedTrend;
    totalWeight += weights.sentimentTrend;
  }

  if (priceVsSma50 !== null) {
    // Normalize momentum to -1 to 1 range (assume ±20% is extreme)
    const normalizedMomentum = Math.max(-1, Math.min(1, priceVsSma50 * 5));
    score += weights.priceMomentum * normalizedMomentum;
    totalWeight += weights.priceMomentum;
  }

  if (optionsScore !== null) {
    score += weights.options * optionsScore;
    totalWeight += weights.options;
  }

  if (fundamentalsScore !== null) {
    score += weights.fundamentals * fundamentalsScore;
    totalWeight += weights.fundamentals;
  }

  if (totalWeight <= 0) return null;

  // Raw score is in [-1, 1] range
  const rawScore = score / totalWeight;

  // Rescale to [0, 1] so buyThreshold: 0.70 is reachable
  // -1 → 0.0, 0 → 0.5, +0.4 → 0.7, +1 → 1.0
  return (rawScore + 1) / 2;
}

/**
 * Compute options-based signal score.
 * Uses IV percentile and put/call ratio.
 * Returns score in [-1, 1] range.
 */
function computeOptionsScore(ivPercentile: number | null, putCallRatio: number | null): number | null {
  if (ivPercentile === null && putCallRatio === null) return null;

  let score = 0;
  let count = 0;

  // IV percentile: low IV = bullish (cheap options), high IV = bearish (expensive/fear)
  if (ivPercentile !== null) {
    // 0.2 IV percentile → +0.6, 0.5 → 0, 0.8 → -0.6
    score += (0.5 - ivPercentile) * 1.2;
    count++;
  }

  // Put/call ratio: high ratio = bearish sentiment, low = bullish
  // Typical range 0.5-1.5, neutral around 0.8-1.0
  if (putCallRatio !== null) {
    // 0.5 → +0.5, 1.0 → 0, 1.5 → -0.5
    const normalizedPcr = Math.max(-1, Math.min(1, (1.0 - putCallRatio) * 2));
    score += normalizedPcr * 0.5;
    count++;
  }

  return count > 0 ? Math.max(-1, Math.min(1, score / count)) : null;
}

/**
 * Compute fundamentals-based signal score.
 * Uses valuation (PE, PEG) and growth metrics.
 * Returns score in [-1, 1] range.
 */
function computeFundamentalsScore(
  trailingPE: number | null,
  forwardPE: number | null,
  pegRatio: number | null,
  revenueGrowth: number | null,
  earningsGrowth: number | null
): { valuationScore: number | null; growthScore: number | null } {
  let valuationScore: number | null = null;
  let growthScore: number | null = null;

  // Valuation score: lower PE/PEG = more attractive
  const valuationSignals: number[] = [];
  
  if (forwardPE !== null && forwardPE > 0) {
    // Forward PE: 10 → +0.5, 20 → 0, 40 → -0.5
    valuationSignals.push(Math.max(-1, Math.min(1, (20 - forwardPE) / 20)));
  } else if (trailingPE !== null && trailingPE > 0) {
    valuationSignals.push(Math.max(-1, Math.min(1, (25 - trailingPE) / 25)));
  }

  if (pegRatio !== null && pegRatio > 0) {
    // PEG: 0.5 → +0.5, 1.0 → 0, 2.0 → -0.5
    valuationSignals.push(Math.max(-1, Math.min(1, (1 - pegRatio))));
  }

  if (valuationSignals.length > 0) {
    valuationScore = valuationSignals.reduce((a, b) => a + b, 0) / valuationSignals.length;
  }

  // Growth score: higher growth = more attractive
  const growthSignals: number[] = [];

  if (revenueGrowth !== null) {
    // Revenue growth: 0% → 0, 20% → +0.5, -20% → -0.5
    growthSignals.push(Math.max(-1, Math.min(1, revenueGrowth * 2.5)));
  }

  if (earningsGrowth !== null) {
    // Earnings growth: 0% → 0, 30% → +0.5, -30% → -0.5
    growthSignals.push(Math.max(-1, Math.min(1, earningsGrowth * 1.67)));
  }

  if (growthSignals.length > 0) {
    growthScore = growthSignals.reduce((a, b) => a + b, 0) / growthSignals.length;
  }

  return { valuationScore, growthScore };
}

/**
 * Compute EWMA-smoothed composite score.
 */
function computeEwma(currentScore: number | null, previousEwma: number | null, alpha: number): number | null {
  if (currentScore === null) return previousEwma;
  if (previousEwma === null) return currentScore;
  return alpha * currentScore + (1 - alpha) * previousEwma;
}

/**
 * Collect signals for a single symbol.
 */
async function collectSymbolSignals(
  symbol: string,
  snapshotDate: string,
  deps: SignalCollectionDeps
): Promise<CollectionResult> {
  const { signalSnapshotsRepo, pricesRepo, newsSource, optionsSource, fundamentalsSource, getSettings } = deps;
  const settings = getSettings();

  // Check if snapshot already exists (skip expensive LLM/FinBERT calls)
  const existing = signalSnapshotsRepo.get(symbol, snapshotDate);
  if (existing) {
    log.debug('snapshot already exists, skipping', { symbol, snapshotDate });
    return { symbol, status: 'skipped', reason: 'already collected today' };
  }

  let tokensUsed = 0;

  try {
    // 1. Get current price
    const latestPrice = pricesRepo.getLatest(symbol);
    const priceCents = latestPrice?.adjCloseCents ?? null;

    // 2. Get news and compute sentiment
    let sentimentScore: number | null = null;
    let sentimentConfidence: number | null = null;
    let sentimentSynthesis: string | null = null;

    try {
      const fromDate = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
      const toDate = new Date().toISOString().slice(0, 10);
      const result = await newsSource.fetch({ symbol, from: fromDate, to: toDate, limit: 10 });
      const articles: NewsArticle[] = result.data.articles;
      
      if (articles.length > 0) {
        let textToScore: string;

        if (settings.signals.useLlm) {
          // LLM-enhanced: synthesize headlines into sentiment summary
          const headlines = articles.map(a => a.headline);
          const synthesis = await synthesizeSentiment({ symbol, headlines });
          textToScore = synthesis.sentimentSummary || headlines.join('. ');
          sentimentSynthesis = synthesis.sentimentSummary || null;
          tokensUsed = synthesis.tokensUsed;
        } else {
          // Direct FinBERT on raw headlines
          textToScore = articles.map(a => a.headline).join('. ');
        }

        const finbertResult = await scoreFinBERT(textToScore);
        sentimentScore = finbertResult.normalizedScore;
        sentimentConfidence = finbertResult.score;
      }
    } catch (err) {
      log.warn('failed to get news sentiment', { symbol, error: err instanceof Error ? err.message : String(err) });
    }

    // 3. Compute sentiment trend from historical data
    const recentSentiment = signalSnapshotsRepo.getRecentSentiment(symbol, settings.signals.rollingWindowDays);
    const sentimentScores = recentSentiment.map(s => s.sentimentScore).reverse();
    if (sentimentScore !== null) sentimentScores.push(sentimentScore);
    const sentimentTrend = computeSentimentTrend(sentimentScores);

    // 4. Compute price vs SMA50
    const prices = pricesRepo.listBySymbol(symbol, 60);
    const priceVsSma50 = computePriceVsSma50(prices);

    // 5. Get options data
    let ivPercentile: number | null = null;
    let putCallRatio: number | null = null;

    try {
      const optionsResult = await optionsSource.fetch({ symbol });
      const metrics = optionsResult.data.metrics;
      
      // IV percentile: use average of nearest OTM call/put IV
      // In production, would compare to 52-week IV range
      const callIv = metrics.nearestOtmCallIv;
      const putIv = metrics.nearestOtmPutIv;
      if (callIv !== null || putIv !== null) {
        const avgIv = (callIv ?? putIv ?? 0 + (putIv ?? callIv ?? 0)) / 2;
        // Normalize: assume 0.15-0.80 is typical range
        ivPercentile = Math.max(0, Math.min(1, (avgIv - 0.15) / 0.65));
      }
      
      putCallRatio = metrics.putCallOpenInterestRatio;
    } catch (err) {
      log.debug('failed to get options data', { symbol, error: err instanceof Error ? err.message : String(err) });
    }

    // 6. Get fundamentals data
    let valuationScore: number | null = null;
    let growthScore: number | null = null;

    try {
      const fundResult = await fundamentalsSource.fetch({ symbol });
      const fund = fundResult.data;
      
      const scores = computeFundamentalsScore(
        fund.trailingPE,
        fund.forwardPE,
        fund.pegRatio,
        fund.revenueGrowth,
        fund.earningsGrowth
      );
      valuationScore = scores.valuationScore;
      growthScore = scores.growthScore;
    } catch (err) {
      log.debug('failed to get fundamentals data', { symbol, error: err instanceof Error ? err.message : String(err) });
    }

    // 7. Compute options score (combined IV + put/call)
    const optionsScore = computeOptionsScore(ivPercentile, putCallRatio);

    // 8. Compute fundamentals score (combined valuation + growth)
    const fundamentalsScoreCombined = (valuationScore !== null || growthScore !== null)
      ? ((valuationScore ?? 0) + (growthScore ?? 0)) / ((valuationScore !== null ? 1 : 0) + (growthScore !== null ? 1 : 0))
      : null;

    // 9. Compute composite score
    const compositeScore = computeCompositeScore(
      sentimentScore,
      sentimentTrend,
      priceVsSma50,
      optionsScore,
      fundamentalsScoreCombined,
      settings.signals.weights
    );

    // 10. Compute EWMA
    const previousSnapshot = signalSnapshotsRepo.getLatest(symbol);
    const compositeEwma = computeEwma(
      compositeScore,
      previousSnapshot?.compositeEwma ?? null,
      settings.signals.ewmaAlpha
    );

    // 11. Store snapshot
    const snapshot: SignalSnapshotRow = {
      id: randomUUID(),
      symbol,
      snapshotDate,
      priceCents,
      sentimentScore,
      sentimentConfidence,
      sentimentTrend,
      priceVsSma50,
      ivPercentile,
      putCallRatio,
      valuationScore,
      growthScore,
      compositeScore,
      compositeEwma,
      sentimentSynthesis,
      createdAt: Date.now(),
    };

    signalSnapshotsRepo.insert(snapshot);

    log.debug('signal collected', {
      symbol,
      snapshotDate,
      sentimentScore,
      optionsScore,
      fundamentalsScoreCombined,
      compositeScore,
      compositeEwma,
    });

    return { symbol, status: 'ok', tokensUsed };
  } catch (err) {
    log.error('failed to collect signals', { symbol, error: err instanceof Error ? err.message : String(err) });
    return { symbol, status: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run daily signal collection for all enabled watchlist symbols.
 * Does NOT make any trading decisions.
 */
export async function runSignalCollection(deps: SignalCollectionDeps): Promise<CollectionResult[]> {
  const { watchlistRepo, positionsRepo, getSettings } = deps;
  const settings = getSettings();

  if (!settings.signals.enabled) {
    log.info('signal collection disabled');
    return [];
  }

  const snapshotDate = new Date().toISOString().split('T')[0];
  const watchlist = watchlistRepo.list().filter(w => w.enabled);
  const watchlistSymbols = watchlist.map(w => w.symbol);
  const positionSymbols = positionsRepo.list().map(p => p.symbol);
  const allSymbols = [...new Set([...watchlistSymbols, ...positionSymbols])];

  if (allSymbols.length === 0) {
    log.info('no symbols in watchlist or positions');
    return [];
  }

  log.info('starting signal collection', { date: snapshotDate, symbolCount: allSymbols.length });

  const results: CollectionResult[] = [];

  for (const symbol of allSymbols) {
    const result = await collectSymbolSignals(symbol, snapshotDate, deps);
    results.push(result);
  }

  const okCount = results.filter(r => r.status === 'ok').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  log.info('signal collection complete', { date: snapshotDate, ok: okCount, errors: errorCount });

  return results;
}
