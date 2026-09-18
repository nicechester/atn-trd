import { Router, type Request, type Response } from 'express';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BacktestRepo } from '../repos/backtestRepo.js';
import { logger } from '../lib/logger.js';
import { createOpenAIChatModel, promptMessages } from '../llm/openaiChatModel.js';
import { BACKTEST_ANALYST_SYSTEM_PROMPT, buildBacktestAnalysisPrompt } from '../llm/prompts/backtestAnalyst.js';

const log = logger.child({ component: 'backtest-routes' });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.BACKTEST_LOG_DIR || '/tmp';

/**
 * Run backtest CLI in background.
 * Spawns the CLI script which uses FNSPID data + signal-based trading logic.
 * Logs stdout/stderr to /tmp/backtest-{id}.log for progress tracking.
 */
function runBacktestCli(
  backtestId: string,
  config: { startDate: string; endDate: string; symbols: string[]; startingCashCents?: number },
  repo: BacktestRepo
): void {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'backtest.ts');
  const cash = config.startingCashCents ? Math.floor(config.startingCashCents / 100) : 100000;
  const logPath = path.join(LOG_DIR, `backtest-${backtestId}.log`);

  const args = [
    scriptPath,
    '--start', config.startDate,
    '--end', config.endDate,
    '--symbols', config.symbols.join(','),
    '--cash', cash.toString(),
  ];

  log.info('spawning backtest CLI', { backtestId, args, logPath });

  // Create/truncate log file
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  logStream.write(`[${new Date().toISOString()}] Starting backtest ${backtestId}\n`);
  logStream.write(`[${new Date().toISOString()}] Config: ${JSON.stringify(config)}\n\n`);

  const child = spawn('npx', ['tsx', ...args], {
    cwd: path.join(__dirname, '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BACKTEST_ID: backtestId },
  });

  let stderr = '';

  child.stdout?.on('data', (data) => {
    const text = data.toString();
    logStream.write(text);
  });

  child.stderr?.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    logStream.write(`[STDERR] ${text}`);
  });

  child.on('close', (code) => {
    logStream.write(`\n[${new Date().toISOString()}] Process exited with code ${code}\n`);
    logStream.end();

    if (code === 0) {
      log.info('backtest CLI completed', { backtestId });
      // CLI already updates the DB, but ensure status is set
      const run = repo.getRun(backtestId);
      if (run?.status === 'running') {
        repo.updateRunStatus(backtestId, 'succeeded');
      }
    } else {
      const errorMsg = stderr || `CLI exited with code ${code}`;
      log.error('backtest CLI failed', { backtestId, code, stderr: stderr.slice(-500) });
      repo.updateRunStatus(backtestId, 'failed', errorMsg.slice(0, 1000));
    }
  });

  child.on('error', (err) => {
    log.error('backtest CLI spawn error', { backtestId, error: err.message });
    repo.updateRunStatus(backtestId, 'failed', err.message);
  });
}

const BacktestRequestSchema = z.object({
  name: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbols: z.array(z.string().toUpperCase()).min(1),
  startingCashCents: z.number().int().positive().optional(),
});

export function createBacktestRoutes(db: Database.Database): Router {
  const router = Router();
  const repo = new BacktestRepo(db);

  // Get available date range for backtesting (from FNSPID data)
  router.get('/date-range', (_req: Request, res: Response) => {
    try {
      // Query actual date range - intersection of prices and news
      const fnspidDbPath = process.env.BACKTEST_DATA_DIR
        ? `${process.env.BACKTEST_DATA_DIR}/fnspid.db`
        : '/Volumes/JetDrive/atn-trd/fnspid/fnspid.db';
      
      const fnspidDb = new Database(fnspidDbPath, { readonly: true });
      const row = fnspidDb.prepare(`
        SELECT 
          MAX(p.minDate, n.minDate) as minDate,
          MIN(p.maxDate, n.maxDate) as maxDate
        FROM 
          (SELECT MIN(date) as minDate, MAX(date) as maxDate FROM prices) p,
          (SELECT MIN(date) as minDate, MAX(date) as maxDate FROM news_sentiment) n
      `).get() as { minDate: string; maxDate: string } | undefined;
      fnspidDb.close();
      
      if (row?.minDate && row?.maxDate) {
        res.json({
          minDate: row.minDate,
          maxDate: row.maxDate,
        });
      } else {
        res.json({
          minDate: '2021-01-01',
          maxDate: '2023-12-28',
        });
      }
    } catch {
      // Fallback if FNSPID DB not available
      res.json({
        minDate: '2021-01-01',
        maxDate: '2023-12-28',
      });
    }
  });

  // List backtest runs
  router.get('/', (_req: Request, res: Response) => {
    try {
      const runs = repo.listRuns(50);
      res.json({ runs });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get backtest run details
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const run = repo.getRun(req.params.id);
      if (!run) {
        res.status(404).json({ error: 'Backtest not found' });
        return;
      }

      const metrics = repo.getMetrics(req.params.id);
      const snapshots = repo.getSnapshots(req.params.id);
      const rawTrades = repo.getTrades(req.params.id);

      // Map snapshots to equity curve format
      const equityCurve = snapshots.map(s => ({
        date: s.asOfDate,
        value: s.totalValueCents / 100,
        benchmark: s.benchmarkValueCents ? s.benchmarkValueCents / 100 : null,
      }));

      // Map trades to expected format
      const trades = rawTrades.map(t => ({
        date: t.tradeDate,
        symbol: t.symbol,
        side: t.side,
        qty: t.qty,
        price: t.priceCents / 100,
        rationale: t.rationale,
      }));

      // Parse settings snapshot
      let settingsSnapshot = null;
      try {
        settingsSnapshot = JSON.parse(run.settingsSnapshot);
      } catch {
        // Invalid JSON, leave as null
      }

      // Add starting/ending values from snapshots
      const startingValue = snapshots.length > 0 ? snapshots[0].totalValueCents / 100 : null;
      const endingValue = snapshots.length > 0 ? snapshots[snapshots.length - 1].totalValueCents / 100 : null;
      const metricsWithValues = metrics ? { ...metrics, startingValue, endingValue } : null;

      res.json({
        run: { ...run, settingsSnapshot },
        metrics: metricsWithValues,
        equityCurve,
        trades,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Start a new backtest (async - returns immediately, runs CLI in background)
  router.post('/', (req: Request, res: Response) => {
    const parsed = BacktestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const config = parsed.data;

    // Ensure SPY is included for benchmark
    const allSymbols = config.symbols.includes('SPY') 
      ? config.symbols 
      : [...config.symbols, 'SPY'];

    // Create the backtest record immediately with 'running' status
    const backtestId = repo.createRun({
      name: config.name,
      startDate: config.startDate,
      endDate: config.endDate,
      symbols: allSymbols,
      settingsSnapshot: '{}',
    });

    // Return immediately
    res.status(202).json({ backtestId, status: 'running' });

    // Spawn CLI in background
    runBacktestCli(backtestId, { ...config, symbols: allSymbols }, repo);
  });

  // Get backtest metrics
  router.get('/:id/metrics', (req: Request, res: Response) => {
    try {
      const metrics = repo.getMetrics(req.params.id);
      if (!metrics) {
        res.status(404).json({ error: 'Metrics not found' });
        return;
      }
      res.json(metrics);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get backtest equity curve (snapshots)
  router.get('/:id/equity', (req: Request, res: Response) => {
    try {
      const snapshots = repo.getSnapshots(req.params.id);
      const equityCurve = snapshots.map(s => ({
        date: s.asOfDate,
        value: s.totalValueCents / 100,
        benchmark: s.benchmarkValueCents ? s.benchmarkValueCents / 100 : null,
      }));
      res.json({ equityCurve });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get backtest trades
  router.get('/:id/trades', (req: Request, res: Response) => {
    try {
      const trades = repo.getTrades(req.params.id);
      const mapped = trades.map(t => ({
        date: t.tradeDate,
        symbol: t.symbol,
        side: t.side,
        qty: t.qty,
        price: t.priceCents / 100,
        rationale: t.rationale,
      }));
      res.json({ trades: mapped });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get backtest log (tail last N lines)
  router.get('/:id/log', (req: Request, res: Response) => {
    try {
      const logPath = path.join(LOG_DIR, `backtest-${req.params.id}.log`);
      const tail = parseInt(req.query.tail as string) || 50;

      if (!fs.existsSync(logPath)) {
        res.json({ lines: [], exists: false });
        return;
      }

      const content = fs.readFileSync(logPath, 'utf-8');
      const allLines = content.split('\n');
      const lines = allLines.slice(-tail).filter(line => line.trim());

      res.json({ lines, exists: true, totalLines: allLines.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Analyze backtest with LLM
  router.post('/:id/analyze', async (req: Request, res: Response) => {
    try {
      const run = repo.getRun(req.params.id);
      if (!run) {
        res.status(404).json({ error: 'Backtest not found' });
        return;
      }

      if (run.status !== 'succeeded') {
        res.status(400).json({ error: 'Can only analyze completed backtests' });
        return;
      }

      const metrics = repo.getMetrics(req.params.id);
      if (!metrics) {
        res.status(400).json({ error: 'No metrics available for this backtest' });
        return;
      }

      const rawTrades = repo.getTrades(req.params.id);
      const trades = rawTrades.map(t => ({
        date: t.tradeDate,
        symbol: t.symbol,
        side: t.side,
        price: t.priceCents / 100,
      }));

      let settings = {};
      try {
        settings = JSON.parse(run.settingsSnapshot) || {};
      } catch {
        // Invalid JSON
      }

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
        trades,
        perSymbol: metrics.perSymbol,
        dateRange: { start: run.startDate, end: run.endDate },
      });

      log.info('analyzing backtest with LLM', { backtestId: req.params.id });

      const model = createOpenAIChatModel({ timeoutMs: 60_000 });
      const messages = promptMessages(prompt, BACKTEST_ANALYST_SYSTEM_PROMPT);
      const completion = await model.complete(messages);

      log.info('backtest analysis complete', {
        backtestId: req.params.id,
        tokens: completion.tokens,
      });

      // Save analysis to DB
      repo.updateAnalysis(req.params.id, completion.content);

      res.json({
        analysis: completion.content,
        model: completion.model,
        tokens: completion.tokens,
      });
    } catch (err) {
      log.error('backtest analysis failed', {
        backtestId: req.params.id,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
