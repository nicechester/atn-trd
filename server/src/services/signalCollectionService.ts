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
import { scoreFinBERT } from './finbertService.js';
import type { NewsDataSource, NewsArticle } from '../datasources/news/index.js';

const log = logger.child({ component: 'signal-collection' });

export interface SignalCollectionDeps {
  signalSnapshotsRepo: SignalSnapshotsRepo;
  pricesRepo: PricesRepo;
  watchlistRepo: WatchlistRepo;
  newsSource: NewsDataSource;
  getSettings: () => Settings;
}

export interface CollectionResult {
  symbol: string;
  status: 'ok' | 'skipped' | 'error';
  reason?: string;
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
 */
function computeCompositeScore(
  sentimentScore: number | null,
  sentimentTrend: number | null,
  priceVsSma50: number | null,
  weights: { sentiment: number; sentimentTrend: number; priceMomentum: number }
): number | null {
  // Need at least sentiment to compute
  if (sentimentScore === null) return null;

  let score = weights.sentiment * sentimentScore;
  let totalWeight = weights.sentiment;

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

  // Re-normalize if not all signals available
  return totalWeight > 0 ? score / totalWeight : null;
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
  const { signalSnapshotsRepo, pricesRepo, newsSource, getSettings } = deps;
  const settings = getSettings();

  try {
    // 1. Get current price
    const latestPrice = pricesRepo.getLatest(symbol);
    const priceCents = latestPrice?.adjCloseCents ?? null;

    // 2. Get news and compute sentiment
    let sentimentScore: number | null = null;
    let sentimentConfidence: number | null = null;

    try {
      const fromDate = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
      const toDate = new Date().toISOString().slice(0, 10);
      const result = await newsSource.fetch({ symbol, from: fromDate, to: toDate, limit: 10 });
      const articles: NewsArticle[] = result.data.articles;
      if (articles.length > 0) {
        const headlines = articles.map(a => a.headline).join('. ');
        const finbertResult = await scoreFinBERT(headlines);
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

    // 5. Compute composite score
    const compositeScore = computeCompositeScore(
      sentimentScore,
      sentimentTrend,
      priceVsSma50,
      settings.signals.weights
    );

    // 6. Compute EWMA
    const previousSnapshot = signalSnapshotsRepo.getLatest(symbol);
    const compositeEwma = computeEwma(
      compositeScore,
      previousSnapshot?.compositeEwma ?? null,
      settings.signals.ewmaAlpha
    );

    // 7. Store snapshot
    const snapshot: SignalSnapshotRow = {
      id: randomUUID(),
      symbol,
      snapshotDate,
      priceCents,
      sentimentScore,
      sentimentConfidence,
      sentimentTrend,
      priceVsSma50,
      compositeScore,
      compositeEwma,
      createdAt: Date.now(),
    };

    signalSnapshotsRepo.upsert(snapshot);

    log.debug('signal collected', {
      symbol,
      snapshotDate,
      sentimentScore,
      compositeScore,
      compositeEwma,
    });

    return { symbol, status: 'ok' };
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
  const { watchlistRepo, getSettings } = deps;
  const settings = getSettings();

  if (!settings.signals.enabled) {
    log.info('signal collection disabled');
    return [];
  }

  const snapshotDate = new Date().toISOString().split('T')[0];
  const watchlist = watchlistRepo.list().filter(w => w.enabled);

  if (watchlist.length === 0) {
    log.info('no symbols in watchlist');
    return [];
  }

  log.info('starting signal collection', { date: snapshotDate, symbolCount: watchlist.length });

  const results: CollectionResult[] = [];

  for (const item of watchlist) {
    const result = await collectSymbolSignals(item.symbol, snapshotDate, deps);
    results.push(result);
  }

  const okCount = results.filter(r => r.status === 'ok').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  log.info('signal collection complete', { date: snapshotDate, ok: okCount, errors: errorCount });

  return results;
}
