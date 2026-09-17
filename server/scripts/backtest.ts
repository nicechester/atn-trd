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
import { runSignalBasedTradingLogic, preloadPriceHistory, type SignalProvider } from '../src/backtest/tradingLogic.js';
import { DEFAULT_SETTINGS, type Settings } from '@atn-trd/shared';
import { runMigrations } from '../src/db/migrate.js';
import { SettingsRepo } from '../src/repos/settingsRepo.js';
import { BacktestRepo } from '../src/repos/backtestRepo.js';
import { createOpenAIChatModel, promptMessages } from '../src/llm/openaiChatModel.js';
import { BACKTEST_ANALYST_SYSTEM_PROMPT, buildBacktestAnalysisPrompt } from '../src/llm/prompts/backtestAnalyst.js';

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
  backtestId?: string;
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
      'backtest-id': { type: 'string' },
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
  --backtest-id     Use existing backtest record (for API-triggered runs)
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
    backtestId: values['backtest-id'] ?? process.env.BACKTEST_ID,
  };
}

/** Adapt FnspidDataSource to SignalProvider interface */
function createFnspidSignalProvider(fnspid: FnspidDataSource): SignalProvider {
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
  };
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
    console.log(`  Buy threshold: ${settings.signals.buyThreshold}`);
    console.log(`  Sell threshold: ${settings.signals.sellThreshold}`);
  } else {
    // Fallback to defaults with simplified weights
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
  console.log();

  // Create signal provider and pre-load price history
  const signalProvider = createFnspidSignalProvider(fnspid);
  console.log(`Pre-loading price history...`);
  const priceHistory = preloadPriceHistory(signalProvider, allSymbols, args.start);
  for (const [symbol, prices] of priceHistory) {
    console.log(`  ${symbol}: ${prices.length} days pre-loaded`);
  }

  // Trading logic using shared module
  const runTradingLogic: BacktestDeps['runTradingLogic'] = async (params) => {
    await runSignalBasedTradingLogic({
      ...params,
      signalProvider,
      priceHistory,
    });
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
    backtestId: args.backtestId,
    name: args.backtestId ? undefined : `CLI Backtest ${args.start} to ${args.end}`,
    startDate: args.start,
    endDate: args.end,
    symbols: allSymbols,
    startingCashCents: args.cash * 100,
    tradingIntervalDays: args.interval,
  };

  // Track progress
  const backtestRepo = new BacktestRepo(atnDb);
  const updateProgress = (progress: string) => {
    if (args.backtestId) {
      backtestRepo.updateProgress(args.backtestId, progress);
    }
    console.log(`[Progress] ${progress}`);
  };

  updateProgress('starting');
  console.log('Running backtest...\n');
  
  updateProgress('simulating_trades');
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

  // Run LLM analysis
  if (result.status === 'succeeded' && result.metrics) {
    updateProgress('running_llm_analysis');
    console.log('\nRunning LLM analysis...');
    try {
      const trades = backtestRepo.getTrades(result.backtestId);

      const prompt = buildBacktestAnalysisPrompt({
        metrics: {
          totalReturn: result.metrics.totalReturn,
          benchmarkReturn: result.metrics.benchmarkReturn,
          sharpeRatio: result.metrics.sharpeRatio,
          sortinoRatio: result.metrics.sortinoRatio,
          maxDrawdown: result.metrics.maxDrawdown,
          winRate: result.metrics.winRate,
          totalTrades: result.metrics.totalTrades,
        },
        settings,
        trades: trades.map(t => ({
          date: t.tradeDate,
          symbol: t.symbol,
          side: t.side,
          price: t.priceCents / 100,
        })),
        perSymbol: result.metrics.perSymbol,
        dateRange: { start: args.start, end: args.end },
      });

      const model = createOpenAIChatModel({ timeoutMs: 90_000 });
      const messages = promptMessages(prompt, BACKTEST_ANALYST_SYSTEM_PROMPT);
      const completion = await model.complete(messages);

      backtestRepo.updateAnalysis(result.backtestId, completion.content);
      updateProgress('completed');
      console.log('LLM analysis saved.');
      console.log(`Tokens used: ${completion.tokens?.totalTokens ?? 'unknown'}`);
    } catch (err) {
      console.error('LLM analysis failed:', err instanceof Error ? err.message : err);
      // Don't fail the backtest if analysis fails
    }
  }

  // Cleanup
  fnspid.close();
  atnDb.close();
}

main().catch(err => {
  console.error('Backtest failed:', err);
  process.exit(1);
});
