#!/usr/bin/env npx tsx
/**
 * Backtest CLI - Run strategic trading logic against FNSPID historical data.
 *
 * Uses the full job replay infrastructure (regimeDetection → signalCollection →
 * planReview → trancheExecutor) with point-in-time ALFRED macro data.
 *
 * Usage:
 *   npx tsx server/scripts/backtest.ts --start 2022-01-01 --end 2023-12-31 --symbols AAPL,MSFT,GOOGL
 */

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Database from 'better-sqlite3';
import { FnspidDataSource } from '../src/datasources/fnspid/index.js';
import { AlfredDataSource } from '../src/datasources/alfred/alfredDataSource.js';
import { runReplay, type BacktestDataProvider, type ReplayResult } from '../src/backtest/index.js';
import { DEFAULT_SETTINGS, type Settings } from '@atn-trd/shared';
import { runMigrations } from '../src/db/migrate.js';
import { SettingsRepo } from '../src/repos/settingsRepo.js';
import { BacktestRepo } from '../src/repos/backtestRepo.js';
import { createOpenAIChatModel, promptMessages } from '../src/llm/openaiChatModel.js';
import { BACKTEST_ANALYST_SYSTEM_PROMPT, buildBacktestAnalysisPrompt } from '../src/llm/prompts/backtestAnalyst.js';
import { calculateMetrics } from '../src/backtest/metrics.js';
import { isTradingDayStr } from '../src/scheduler/marketCalendar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_FNSPID_DB = process.env.FNSPID_DB_PATH || '/Volumes/JetDrive/atn-trd/fnspid/fnspid.db';
const DEFAULT_ALFRED_DB = process.env.ALFRED_DB_PATH || '/Volumes/JetDrive/atn-trd/alfred/alfred.db';
const DEFAULT_ATN_DB = process.env.ATN_DB_PATH || '../data/atn.db';

interface BacktestArgs {
  start: string;
  end: string;
  symbols: string[];
  cash: number;
  fnspidDb: string;
  alfredDb: string;
  atnDb: string;
  backtestId?: string;
  noAnalysis: boolean;
}

function parseArguments(): BacktestArgs {
  const { values } = parseArgs({
    options: {
      start: { type: 'string', short: 's' },
      end: { type: 'string', short: 'e' },
      symbols: { type: 'string' },
      cash: { type: 'string', default: '100000' },
      'fnspid-db': { type: 'string', default: DEFAULT_FNSPID_DB },
      'alfred-db': { type: 'string', default: DEFAULT_ALFRED_DB },
      'atn-db': { type: 'string', default: DEFAULT_ATN_DB },
      'backtest-id': { type: 'string' },
      'no-analysis': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help || !values.start || !values.end || !values.symbols) {
    console.log(`
Backtest CLI - Run strategic trading logic against FNSPID historical data.

Uses full job replay: regimeDetection → signalCollection → planReview → trancheExecutor

Usage:
  npx tsx scripts/backtest.ts --start 2022-01-01 --end 2023-12-31 --symbols AAPL,MSFT,GOOGL

Options:
  -s, --start       Start date (YYYY-MM-DD) [required]
  -e, --end         End date (YYYY-MM-DD) [required]
  --symbols         Comma-separated list of symbols [required]
  --cash            Starting cash in dollars (default: 100000)
  --fnspid-db       Path to fnspid.db (default: ${DEFAULT_FNSPID_DB})
  --alfred-db       Path to alfred.db (default: ${DEFAULT_ALFRED_DB})
  --atn-db          Path to atn.db (default: ${DEFAULT_ATN_DB})
  --backtest-id     Use existing backtest record (for API-triggered runs)
  --no-analysis     Skip LLM analysis at end
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
    alfredDb: values['alfred-db'] ?? DEFAULT_ALFRED_DB,
    atnDb: values['atn-db'] ?? DEFAULT_ATN_DB,
    backtestId: values['backtest-id'] ?? process.env.BACKTEST_ID,
    noAnalysis: values['no-analysis'] ?? false,
  };
}

/** Create BacktestDataProvider from FNSPID + ALFRED */
function createDataProvider(fnspid: FnspidDataSource, alfred: AlfredDataSource | null): BacktestDataProvider {
  return {
    getSentiment(symbol: string, date: string): number | null {
      const sentiment = fnspid.getSentimentAsOf(symbol, date);
      return sentiment?.sentimentScore ?? null;
    },
    getPrice(symbol: string, date: string) {
      return fnspid.getPrice(symbol, date);
    },
    getPriceRange(symbol: string, startDate: string, endDate: string) {
      return fnspid.getPriceRange(symbol, startDate, endDate);
    },
    getVix(date: string): number | null {
      return alfred?.getVix(date) ?? null;
    },
    getYieldCurve(date: string): number | null {
      return alfred?.getYieldCurve(date) ?? null;
    },
  };
}

async function main() {
  const args = parseArguments();

  console.log('Backtest Configuration:');
  console.log(`  Start: ${args.start}`);
  console.log(`  End: ${args.end}`);
  console.log(`  Symbols: ${args.symbols.join(', ')}`);
  console.log(`  Starting Cash: $${args.cash.toLocaleString()}`);
  console.log(`  FNSPID DB: ${args.fnspidDb}`);
  console.log(`  Alfred DB: ${args.alfredDb}`);
  console.log(`  ATN DB: ${args.atnDb}`);
  console.log();

  // Initialize data sources
  const fnspid = new FnspidDataSource({ dbPath: args.fnspidDb });
  let alfred: AlfredDataSource | null = null;
  try {
    alfred = new AlfredDataSource({ dbPath: args.alfredDb });
    const alfredRange = alfred.getDateRange();
    console.log(`ALFRED Data Range: ${alfredRange?.minDate} to ${alfredRange?.maxDate}`);
  } catch {
    console.warn('Warning: ALFRED database not found, regime detection will use defaults');
  }

  const atnDb = new Database(args.atnDb);

  // Run migrations to ensure tables exist
  const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations');
  runMigrations(atnDb, migrationsDir);
  console.log('Migrations complete');

  // Skip slow date range scan - data availability checked during replay
  console.log('FNSPID database loaded');

  // Ensure SPY is included for benchmark
  const allSymbols = args.symbols.includes('SPY') ? args.symbols : [...args.symbols, 'SPY'];

  // Load settings from database, fall back to defaults
  const settingsRepo = new SettingsRepo(atnDb);
  const savedSettings = settingsRepo.read();
  let settings: Settings;

  if (savedSettings) {
    const parsed = JSON.parse(savedSettings.doc) as Settings;
    // Override weights for backtest (no options/fundamentals in FNSPID)
    settings = {
      ...parsed,
      signals: {
        ...parsed.signals,
        weights: {
          sentiment: 0.6,
          sentimentTrend: 0.1,
          priceMomentum: 0.3,
          options: 0,
          fundamentals: 0,
        },
      },
    };
    console.log('Loaded settings from database');
  } else {
    settings = {
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
    console.log('Using default settings');
  }

  console.log(`  Buy threshold: ${settings.signals.buyThreshold}`);
  console.log(`  Sell threshold: ${settings.signals.sellThreshold}`);
  console.log(`  Regime enabled: ${settings.regime.enabled}`);
  console.log(`  VIX risk-off threshold: ${settings.regime.vixRiskOffThreshold}`);
  console.log();

  // Create data provider
  console.log('Creating data provider...');
  const dataProvider = createDataProvider(fnspid, alfred);

  // Setup backtest repo for persistence
  console.log('Setting up backtest record...');
  const backtestRepo = new BacktestRepo(atnDb);
  const backtestId = args.backtestId ?? backtestRepo.createRun({
    name: args.backtestId ? undefined : `CLI Backtest ${args.start} to ${args.end}`,
    startDate: args.start,
    endDate: args.end,
    symbols: allSymbols,
    settingsSnapshot: JSON.stringify(settings),
  });

  if (args.backtestId) {
    backtestRepo.updateSettingsSnapshot(backtestId, JSON.stringify(settings));
  }

  const updateProgress = (progress: string) => {
    if (args.backtestId) {
      backtestRepo.updateProgress(args.backtestId, progress);
    }
    console.log(`[Progress] ${progress}`);
  };

  updateProgress('starting');
  console.log('Running backtest with full job replay...');
  console.log(`  Processing ${args.start} to ${args.end}...\n`);

  // Track snapshots and trades for metrics
  const snapshots: Array<{ asOfDate: string; totalValueCents: number; benchmarkValueCents?: number }> = [];
  const trades: Array<{ tradeDate: string; symbol: string; side: string; qty: number; priceCents: number }> = [];

  // Get initial benchmark price for normalization
  let initialBenchmarkPrice: number | null = null;
  const spyPrice = dataProvider.getPrice('SPY', args.start);
  if (spyPrice) {
    initialBenchmarkPrice = spyPrice.adjCloseCents;
  }
  const initialValueCents = args.cash * 100;

  updateProgress('simulating_trades');

  // Run replay
  const result: ReplayResult = await runReplay({
    startDate: args.start,
    endDate: args.end,
    symbols: allSymbols.filter(s => s !== 'SPY'), // Watchlist excludes benchmark
    startingCashCents: initialValueCents,
    settings,
    dataProvider,
    onDayComplete: (date, snapshot) => {
      // Skip non-trading days
      if (!isTradingDayStr(date)) return;

      // Calculate benchmark value (normalized to starting portfolio)
      const currentSpyPrice = dataProvider.getPrice('SPY', date);
      const benchmarkValueCents = initialBenchmarkPrice && currentSpyPrice
        ? Math.round(initialValueCents * (currentSpyPrice.adjCloseCents / initialBenchmarkPrice))
        : undefined;

      // Record snapshot
      const totalValueCents = snapshot.portfolioValueCents;
      snapshots.push({ asOfDate: date, totalValueCents, benchmarkValueCents });

      backtestRepo.createSnapshot({
        backtestId,
        asOfDate: date,
        cashCents: snapshot.cashCents,
        positions: snapshot.positions.map(p => ({ symbol: p.symbol, qty: p.qty })),
        totalValueCents,
        benchmarkValueCents,
      });

      // Record new fills
      for (const fill of snapshot.fills) {
        if (fill.date === date) {
          trades.push({
            tradeDate: date,
            symbol: fill.symbol,
            side: fill.side,
            qty: fill.qty,
            priceCents: fill.priceCents,
          });
          backtestRepo.createTrade({
            backtestId,
            tradeDate: date,
            symbol: fill.symbol,
            side: fill.side,
            qty: fill.qty,
            priceCents: fill.priceCents,
          });
        }
      }

      // Progress every 20 days
      if (snapshots.length % 20 === 0) {
        console.log(`  ${date}: $${(totalValueCents / 100).toLocaleString()} (${snapshots.length} days)`);
      }
    },
  });

  // Calculate and save metrics
  const metrics = calculateMetrics({
    backtestId,
    snapshots: snapshots.map(s => ({
      asOfDate: s.asOfDate,
      totalValueCents: s.totalValueCents,
      benchmarkValueCents: s.benchmarkValueCents ?? null,
    })),
    trades: trades.map(t => ({
      tradeDate: t.tradeDate,
      symbol: t.symbol,
      side: t.side as 'buy' | 'sell',
      qty: t.qty,
      priceCents: t.priceCents,
    })),
  });
  backtestRepo.saveMetrics(metrics);
  backtestRepo.updateRunStatus(backtestId, 'succeeded');

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('BACKTEST RESULTS');
  console.log('='.repeat(60));

  console.log(`\nPerformance:`);
  console.log(`  Total Return:     ${(metrics.totalReturn * 100).toFixed(2)}%`);
  console.log(`  Benchmark Return: ${(metrics.benchmarkReturn * 100).toFixed(2)}%`);
  console.log(`  Alpha:            ${((metrics.totalReturn - metrics.benchmarkReturn) * 100).toFixed(2)}%`);

  console.log(`\nRisk Metrics:`);
  console.log(`  Sharpe Ratio:     ${metrics.sharpeRatio?.toFixed(2) ?? 'N/A'}`);
  console.log(`  Sortino Ratio:    ${metrics.sortinoRatio?.toFixed(2) ?? 'N/A'}`);
  console.log(`  Max Drawdown:     ${(metrics.maxDrawdown * 100).toFixed(2)}%`);

  console.log(`\nTrading:`);
  console.log(`  Total Trades:     ${metrics.totalTrades}`);
  console.log(`  Win Rate:         ${metrics.winRate !== null ? (metrics.winRate * 100).toFixed(1) + '%' : 'N/A'}`);
  console.log(`  Plans Created:    ${result.plansCreated}`);
  console.log(`  Trim Plans:       ${result.trimPlansCreated}`);

  console.log(`\nFinal State:`);
  console.log(`  Cash:             $${(result.finalState.cashCents / 100).toLocaleString()}`);
  console.log(`  Positions:        ${result.finalState.positions.length}`);
  console.log(`  Portfolio Value:  $${(result.finalState.portfolioValueCents / 100).toLocaleString()}`);

  console.log(`\nBacktest ID: ${backtestId}`);
  console.log('='.repeat(60));

  // Run LLM analysis
  if (args.noAnalysis) {
    updateProgress('completed');
    console.log('\nSkipping LLM analysis (--no-analysis)');
  } else {
  updateProgress('running_llm_analysis');
  console.log('\nRunning LLM analysis...');
  try {
    const prompt = buildBacktestAnalysisPrompt({
      metrics: {
        totalReturn: metrics.totalReturn,
        benchmarkReturn: metrics.benchmarkReturn,
        sharpeRatio: metrics.sharpeRatio,
        sortinoRatio: metrics.sortinoRatio,
        maxDrawdown: metrics.maxDrawdown,
        winRate: metrics.winRate,
        totalTrades: metrics.totalTrades,
      },
      settings,
      trades: trades.map(t => ({
        date: t.tradeDate,
        symbol: t.symbol,
        side: t.side,
        price: t.priceCents / 100,
      })),
      perSymbol: metrics.perSymbol,
      dateRange: { start: args.start, end: args.end },
    });

    const model = createOpenAIChatModel({ timeoutMs: 90_000 });
    const messages = promptMessages(prompt, BACKTEST_ANALYST_SYSTEM_PROMPT);
    const completion = await model.complete(messages);

    backtestRepo.updateAnalysis(backtestId, completion.content);
    updateProgress('completed');
    console.log('LLM analysis saved.');
    console.log(`Tokens used: ${completion.tokens?.totalTokens ?? 'unknown'}`);
  } catch (err) {
    console.error('LLM analysis failed:', err instanceof Error ? err.message : err);
  }
  }

  // Cleanup
  fnspid.close();
  alfred?.close();
  atnDb.close();
}

main().catch(err => {
  console.error('Backtest failed:', err);
  process.exit(1);
});
