#!/usr/bin/env npx tsx
/**
 * Backtest CLI - Run strategic trading logic against FNSPID historical data.
 *
 * Usage:
 *   npx tsx server/scripts/backtest.ts --start 2022-01-01 --end 2023-12-31 --symbols AAPL,MSFT,GOOGL
 */

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Database from 'better-sqlite3';
import { FnspidDataSource } from '../src/datasources/fnspid/index.js';
import { BacktestRunner, type BacktestConfig, type BacktestDeps } from '../src/backtest/runner.js';
import { DEFAULT_SETTINGS, type Settings } from '@atn-trd/shared';
import { runMigrations } from '../src/db/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_FNSPID_DB = process.env.FNSPID_DB_PATH || '/Volumes/JetDrive/atn-trd/fnspid/fnspid.db';
const DEFAULT_ATN_DB = process.env.ATN_DB_PATH || '../data/atn.db';

interface BacktestArgs {
  start: string;
  end: string;
  symbols: string[];
  cash: number;
  fnspidDb: string;
  atnDb: string;
  interval: number;
}

function parseArguments(): BacktestArgs {
  const { values } = parseArgs({
    options: {
      start: { type: 'string', short: 's' },
      end: { type: 'string', short: 'e' },
      symbols: { type: 'string' },
      cash: { type: 'string', default: '100000' },
      'fnspid-db': { type: 'string', default: DEFAULT_FNSPID_DB },
      'atn-db': { type: 'string', default: DEFAULT_ATN_DB },
      interval: { type: 'string', default: '7' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help || !values.start || !values.end || !values.symbols) {
    console.log(`
Backtest CLI - Run strategic trading logic against FNSPID historical data.

Usage:
  npx tsx scripts/backtest.ts --start 2022-01-01 --end 2023-12-31 --symbols AAPL,MSFT,GOOGL

Options:
  -s, --start       Start date (YYYY-MM-DD) [required]
  -e, --end         End date (YYYY-MM-DD) [required]
  --symbols         Comma-separated list of symbols [required]
  --cash            Starting cash in dollars (default: 100000)
  --fnspid-db       Path to fnspid.db (default: ${DEFAULT_FNSPID_DB})
  --atn-db          Path to atn.db (default: ${DEFAULT_ATN_DB})
  --interval        Trading interval in days (default: 7 = weekly)
  -h, --help        Show this help message
`);
    process.exit(values.help ? 0 : 1);
  }

  return {
    start: values.start,
    end: values.end,
    symbols: values.symbols.split(',').map(s => s.trim().toUpperCase()),
    cash: parseInt(values.cash ?? '100000', 10),
    fnspidDb: values['fnspid-db'] ?? DEFAULT_FNSPID_DB,
    atnDb: values['atn-db'] ?? DEFAULT_ATN_DB,
    interval: parseInt(values.interval ?? '7', 10),
  };
}

/**
 * Compute composite score from FNSPID sentiment + price momentum.
 * Simplified version of signalCollectionService logic.
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

async function main() {
  const args = parseArguments();

  console.log('Backtest Configuration:');
  console.log(`  Start: ${args.start}`);
  console.log(`  End: ${args.end}`);
  console.log(`  Symbols: ${args.symbols.join(', ')}`);
  console.log(`  Starting Cash: $${args.cash.toLocaleString()}`);
  console.log(`  Trading Interval: ${args.interval} days`);
  console.log(`  FNSPID DB: ${args.fnspidDb}`);
  console.log(`  ATN DB: ${args.atnDb}`);
  console.log();

  // Initialize data sources
  const fnspid = new FnspidDataSource({ dbPath: args.fnspidDb });
  const atnDb = new Database(args.atnDb);

  // Run migrations to ensure tables exist
  const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations');
  runMigrations(atnDb, migrationsDir);

  // Verify date range
  const dateRange = fnspid.getDateRange();
  if (!dateRange) {
    console.error('Error: Could not read date range from FNSPID database');
    process.exit(1);
  }

  console.log(`FNSPID Data Range: ${dateRange.minDate} to ${dateRange.maxDate}`);

  if (args.start < dateRange.minDate || args.end > dateRange.maxDate) {
    console.warn(`Warning: Requested range (${args.start} to ${args.end}) extends beyond available data`);
  }

  // Ensure SPY is included for benchmark
  const allSymbols = args.symbols.includes('SPY') ? args.symbols : [...args.symbols, 'SPY'];

  // Settings with simplified weights (no options/fundamentals in FNSPID)
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    signals: {
      ...DEFAULT_SETTINGS.signals,
      weights: {
        sentiment: 0.6,
        sentimentTrend: 0.1,
        priceMomentum: 0.3,
        options: 0,
        fundamentals: 0,
      },
    },
  };

  // Price history cache for SMA calculation - pre-load 60 days before start
  const priceHistory: Map<string, Array<{ date: string; adjCloseCents: number }>> = new Map();
  
  // Pre-load price history for SMA calculation
  const preloadStart = new Date(args.start);
  preloadStart.setDate(preloadStart.getDate() - 70); // 70 days before to ensure 50+ trading days
  const preloadStartStr = preloadStart.toISOString().split('T')[0];
  
  console.log(`Pre-loading price history from ${preloadStartStr}...`);
  for (const symbol of allSymbols) {
    const prices = fnspid.getPriceRange(symbol, preloadStartStr, args.start);
    if (prices.length > 0) {
      priceHistory.set(symbol, prices.map(p => ({ date: p.date, adjCloseCents: p.adjCloseCents })));
      console.log(`  ${symbol}: ${prices.length} days pre-loaded`);
    }
  }

  // Trading logic using FNSPID data
  const runTradingLogic: BacktestDeps['runTradingLogic'] = async ({ date, symbols, broker }) => {
    const positions = broker.getPositionsSnapshot();
    const cashCents = broker.getCashCents();

    // Collect signals for each symbol
    const signals: Array<{ symbol: string; score: number }> = [];

    for (const symbol of symbols) {
      if (symbol === 'SPY') continue; // Skip benchmark

      // Get sentiment
      const sentiment = fnspid.getSentimentAsOf(symbol, date);
      const sentimentScore = sentiment?.sentimentScore ?? null;

      // Get price history for SMA
      let history = priceHistory.get(symbol);
      if (!history) {
        history = [];
        priceHistory.set(symbol, history);
      }

      const price = fnspid.getPrice(symbol, date);
      if (price) {
        history.push({ date, adjCloseCents: price.adjCloseCents });
        if (history.length > 60) history.shift(); // Keep last 60 days
      }

      const priceVsSma50 = computePriceVsSma50(history);
      const compositeScore = computeCompositeScore(sentimentScore, priceVsSma50, {
        sentiment: settings.signals.weights.sentiment,
        priceMomentum: settings.signals.weights.priceMomentum,
      });

      if (compositeScore !== null && compositeScore >= settings.signals.buyThreshold) {
        signals.push({ symbol, score: compositeScore });
      }
    }

    // Sort by score descending
    signals.sort((a, b) => b.score - a.score);

    // Simple allocation: equal weight among top signals
    const maxPositions = 5;
    const targetSymbols = signals.slice(0, maxPositions).map(s => s.symbol);

    // Buy signals we don't have
    for (const symbol of targetSymbols) {
      if (positions[symbol]) continue; // Already have position

      const price = fnspid.getPrice(symbol, date);
      if (!price || price.openCents <= 0) continue;

      const allocationCents = Math.floor(cashCents / (maxPositions - Object.keys(positions).length));
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
    for (const symbol of Object.keys(positions)) {
      if (symbol === 'SPY') continue;

      const sentiment = fnspid.getSentimentAsOf(symbol, date);
      const sentimentScore = sentiment?.sentimentScore ?? null;
      const history = priceHistory.get(symbol) ?? [];
      const priceVsSma50 = computePriceVsSma50(history);
      const compositeScore = computeCompositeScore(sentimentScore, priceVsSma50, {
        sentiment: settings.signals.weights.sentiment,
        priceMomentum: settings.signals.weights.priceMomentum,
      });

      if (compositeScore !== null && compositeScore < settings.signals.sellThreshold) {
        const qty = positions[symbol];
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
  };

  // Create backtest deps
  const deps: BacktestDeps = {
    db: atnDb,
    priceProvider: fnspid.createPriceProvider(),
    getBenchmarkPrice: fnspid.createBenchmarkProvider(),
    runTradingLogic,
    settings,
  };

  // Run backtest
  const runner = new BacktestRunner(deps);
  const config: BacktestConfig = {
    name: `CLI Backtest ${args.start} to ${args.end}`,
    startDate: args.start,
    endDate: args.end,
    symbols: allSymbols,
    startingCashCents: args.cash * 100,
    tradingIntervalDays: args.interval,
  };

  console.log('Running backtest...\n');
  const result = await runner.run(config);

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('BACKTEST RESULTS');
  console.log('='.repeat(60));
  console.log(`Status: ${result.status}`);

  if (result.error) {
    console.log(`Error: ${result.error}`);
  }

  if (result.metrics) {
    const m = result.metrics;
    console.log(`\nPerformance:`);
    console.log(`  Total Return:     ${(m.totalReturn * 100).toFixed(2)}%`);
    console.log(`  Benchmark Return: ${(m.benchmarkReturn * 100).toFixed(2)}%`);
    console.log(`  Alpha:            ${((m.totalReturn - m.benchmarkReturn) * 100).toFixed(2)}%`);
    console.log(`\nRisk Metrics:`);
    console.log(`  Sharpe Ratio:     ${m.sharpeRatio?.toFixed(2) ?? 'N/A'}`);
    console.log(`  Sortino Ratio:    ${m.sortinoRatio?.toFixed(2) ?? 'N/A'}`);
    console.log(`  Max Drawdown:     ${(m.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`\nTrading:`);
    console.log(`  Total Trades:     ${m.totalTrades}`);
    console.log(`  Win Rate:         ${m.winRate !== null ? (m.winRate * 100).toFixed(1) + '%' : 'N/A'}`);
  }

  console.log(`\nBacktest ID: ${result.backtestId}`);
  console.log('='.repeat(60));

  // Cleanup
  fnspid.close();
  atnDb.close();
}

main().catch(err => {
  console.error('Backtest failed:', err);
  process.exit(1);
});
