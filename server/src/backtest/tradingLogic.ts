/**
 * Signal-based trading logic for backtesting.
 * Computes composite scores from sentiment + price momentum and executes trades.
 */

import type { Settings } from '@atn-trd/shared';
import type { MockBroker } from '../brokers/mockBroker.js';

export interface SignalProvider {
  /** Get sentiment score for symbol as of date (point-in-time) */
  getSentiment(symbol: string, date: string): number | null;
  /** Get price for symbol on date */
  getPrice(symbol: string, date: string): { openCents: number; closeCents: number; adjCloseCents: number } | null;
  /** Get price range for SMA calculation */
  getPriceRange(symbol: string, startDate: string, endDate: string): Array<{ date: string; adjCloseCents: number }>;
}

interface TradingLogicParams {
  date: string;
  symbols: string[];
  broker: MockBroker;
  settings: Settings;
  signalProvider: SignalProvider;
  priceHistory: Map<string, Array<{ date: string; adjCloseCents: number }>>;
}

/**
 * Compute composite score from sentiment + price momentum.
 */
function computeCompositeScore(
  sentimentScore: number | null,
  priceVsSma50: number | null,
  weights: { sentiment: number; priceMomentum: number }
): number | null {
  let score = 0;
  let totalWeight = 0;

  if (sentimentScore !== null) {
    score += weights.sentiment * sentimentScore;
    totalWeight += weights.sentiment;
  }

  if (priceVsSma50 !== null) {
    const normalizedMomentum = Math.max(-1, Math.min(1, priceVsSma50 * 5));
    score += weights.priceMomentum * normalizedMomentum;
    totalWeight += weights.priceMomentum;
  }

  if (totalWeight <= 0) return null;

  const rawScore = score / totalWeight;
  return (rawScore + 1) / 2; // Rescale to [0, 1]
}

/**
 * Compute price vs 50-day SMA.
 */
function computePriceVsSma50(prices: Array<{ adjCloseCents: number }>): number | null {
  if (prices.length < 50) return null;
  const currentPrice = prices[prices.length - 1].adjCloseCents;
  const sma50 = prices.slice(-50).reduce((sum, p) => sum + p.adjCloseCents, 0) / 50;
  if (sma50 === 0) return null;
  return (currentPrice - sma50) / sma50;
}

/**
 * Run signal-based trading logic for a single day.
 */
export async function runSignalBasedTradingLogic(params: TradingLogicParams): Promise<void> {
  const { date, symbols, broker, settings, signalProvider, priceHistory } = params;
  const positionsArray = broker.getPositionsSnapshot();
  const positions = new Map(positionsArray.map(p => [p.symbol, p.qty]));
  const cashCents = broker.getCashCents();
  const portfolioValue = cashCents + positionsArray.reduce((sum, p) => {
    const price = signalProvider.getPrice(p.symbol, date);
    return sum + (price ? p.qty * price.closeCents : 0);
  }, 0);

  const weights = {
    sentiment: settings.signals.weights.sentiment,
    priceMomentum: settings.signals.weights.priceMomentum,
  };

  // Use risk settings
  const maxPositions = settings.risk.maxConcurrentPositions;
  const maxPositionWeightPercent = settings.risk.maxPositionWeightPercent;
  const maxPositionCents = Math.floor(portfolioValue * (maxPositionWeightPercent / 100));

  // Collect signals for each symbol
  const signals: Array<{ symbol: string; score: number }> = [];

  for (const symbol of symbols) {
    if (symbol === 'SPY') continue; // Skip benchmark

    // Get sentiment
    const sentimentScore = signalProvider.getSentiment(symbol, date);

    // Update price history
    let history = priceHistory.get(symbol);
    if (!history) {
      history = [];
      priceHistory.set(symbol, history);
    }

    const price = signalProvider.getPrice(symbol, date);
    if (price) {
      history.push({ date, adjCloseCents: price.adjCloseCents });
      if (history.length > 60) history.shift(); // Keep last 60 days
    }

    const priceVsSma50 = computePriceVsSma50(history);
    const compositeScore = computeCompositeScore(sentimentScore, priceVsSma50, weights);

    if (compositeScore !== null && compositeScore >= settings.signals.buyThreshold) {
      signals.push({ symbol, score: compositeScore });
    }
  }

  // Sort by score descending
  signals.sort((a, b) => b.score - a.score);

  // Buy signals we don't have (respect maxPositions)
  const availableSlots = maxPositions - positions.size;
  const targetSymbols = signals.slice(0, availableSlots).map(s => s.symbol);

  // Buy signals we don't have
  for (const symbol of targetSymbols) {
    if (positions.has(symbol)) continue; // Already have position

    const price = signalProvider.getPrice(symbol, date);
    if (!price || price.openCents <= 0) continue;

    // Position size: min of (equal allocation, max position weight)
    const equalAllocation = Math.floor(cashCents / Math.max(1, availableSlots));
    const allocationCents = Math.min(equalAllocation, maxPositionCents);
    const qty = Math.floor(allocationCents / price.openCents);

    if (qty > 0) {
      await broker.submitOrder({
        clientOrderId: `bt-${date}-${symbol}`,
        symbol,
        side: 'buy',
        qty,
        type: 'market',
        tif: 'day',
      });
    }
  }

  // Sell positions that dropped below threshold
  for (const [symbol, qty] of positions) {
    if (symbol === 'SPY') continue;

    const sentimentScore = signalProvider.getSentiment(symbol, date);
    const history = priceHistory.get(symbol) ?? [];
    const priceVsSma50 = computePriceVsSma50(history);
    const compositeScore = computeCompositeScore(sentimentScore, priceVsSma50, weights);

    if (compositeScore !== null && compositeScore < settings.signals.sellThreshold) {
      if (qty > 0) {
        await broker.submitOrder({
          clientOrderId: `bt-${date}-${symbol}-sell`,
          symbol,
          side: 'sell',
          qty,
          type: 'market',
          tif: 'day',
        });
      }
    }
  }
}

/**
 * Pre-load price history for SMA calculation.
 */
export function preloadPriceHistory(
  signalProvider: SignalProvider,
  symbols: string[],
  startDate: string,
  daysBack = 70
): Map<string, Array<{ date: string; adjCloseCents: number }>> {
  const priceHistory = new Map<string, Array<{ date: string; adjCloseCents: number }>>();

  const preloadStart = new Date(startDate);
  preloadStart.setDate(preloadStart.getDate() - daysBack);
  const preloadStartStr = preloadStart.toISOString().split('T')[0];

  for (const symbol of symbols) {
    const prices = signalProvider.getPriceRange(symbol, preloadStartStr, startDate);
    if (prices.length > 0) {
      priceHistory.set(symbol, prices.map(p => ({ date: p.date, adjCloseCents: p.adjCloseCents })));
    }
  }

  return priceHistory;
}
