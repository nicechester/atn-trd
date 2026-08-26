import express, { Express, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { AppError, ValidationError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { requireAuth, requireWrite } from './middleware/auth.js';
import { loginHandler, logoutHandler, meHandler } from './routes/auth.js';
import { healthHandler } from './routes/health.js';
import { getSettingsHandler, patchSettingsHandler } from './routes/settings.js';
import { getSecretsHandler, putSecretHandler, deleteSecretHandler } from './routes/secrets.js';
import { testLlmHandler } from './routes/llm.js';
import { listDataSourcesHandler, testDataSourceHandler } from './routes/datasources.js';
import {
  validateSymbolHandler,
  listWatchlistHandler,
  addWatchlistHandler,
  removeWatchlistHandler,
  patchWatchlistHandler,
} from './routes/watchlist.js';
import { nextRunsHandler } from './routes/scheduler.js';
import {
  verifySchedulerAuth,
  triggerTradingCycleHandler,
  triggerSnapshotHandler,
  triggerMarketOpenFillHandler,
} from './routes/trigger.js';
import { listRunsHandler, getRunHandler, triggerRunHandler, getRunCoverageHandler, cancelRunHandler } from './routes/runs.js';
import { getPortfolioHandler, getPortfolioHistoryHandler, transferFundsHandler } from './routes/portfolio.js';
import { listTradesHandler, getTradeHandler, listPendingOrdersHandler, cancelPendingOrderHandler, cancelPendingOrdersBulkHandler } from './routes/trades.js';
import { getCalibrationHandler } from './routes/calibration.js';
import { getPerformanceHandler } from './routes/performance.js';
import { runProgressStreamHandler } from './routes/runProgress.js';
import { triggerBackfillHandler, listTrackedSymbolsHandler } from './routes/prices.js';
import { createBacktestRoutes } from './routes/backtest.js';
import { getDatabase } from './db/index.js';

interface AppOptions {
  staticRoot?: string;
  viteDevMiddleware?: express.Handler;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug('incoming request', {
      method: req.method,
      path: req.path,
    });
    next();
  });

  // ── Public routes (no auth) ─────────────────────────────────────────────────
  app.get('/api/health', healthHandler);
  app.post('/api/auth/login', loginHandler);
  app.post('/api/auth/logout', logoutHandler);

  // Cloud Scheduler triggers (OIDC auth, not user auth)
  app.post('/api/trigger/trading-cycle', verifySchedulerAuth, triggerTradingCycleHandler);
  app.post('/api/trigger/snapshot', verifySchedulerAuth, triggerSnapshotHandler);
  app.post('/api/trigger/market-open-fill', verifySchedulerAuth, triggerMarketOpenFillHandler);

  // ── Authenticated routes ────────────────────────────────────────────────────
  app.get('/api/auth/me', requireAuth, meHandler);

  // Read-only routes (any authenticated user)
  app.get('/api/settings', requireAuth, getSettingsHandler);
  app.get('/api/secrets', requireAuth, getSecretsHandler);
  app.get('/api/watchlist', requireAuth, listWatchlistHandler);
  app.get('/api/datasources', requireAuth, listDataSourcesHandler);
  app.get('/api/scheduler/next-runs', requireAuth, nextRunsHandler);
  app.get('/api/runs', requireAuth, listRunsHandler);
  app.get('/api/runs/progress/stream', requireAuth, runProgressStreamHandler);
  app.get('/api/runs/:id', requireAuth, getRunHandler);
  app.get('/api/runs/:id/coverage', requireAuth, getRunCoverageHandler);
  app.get('/api/portfolio', requireAuth, getPortfolioHandler);
  app.get('/api/portfolio/history', requireAuth, getPortfolioHistoryHandler);
  app.get('/api/trades', requireAuth, listTradesHandler);
  app.get('/api/trades/pending', requireAuth, listPendingOrdersHandler);
  app.get('/api/trades/:id', requireAuth, getTradeHandler);
  app.get('/api/calibration', requireAuth, getCalibrationHandler);
  app.get('/api/performance', requireAuth, getPerformanceHandler);
  app.get('/api/prices/symbols', requireAuth, listTrackedSymbolsHandler);

  // Write routes (chester only)
  app.patch('/api/settings', requireAuth, requireWrite, patchSettingsHandler);
  app.put('/api/secrets/:name', requireAuth, requireWrite, putSecretHandler);
  app.delete('/api/secrets/:name', requireAuth, requireWrite, deleteSecretHandler);
  app.post('/api/symbols/validate', requireAuth, requireWrite, validateSymbolHandler);
  app.post('/api/watchlist', requireAuth, requireWrite, addWatchlistHandler);
  app.patch('/api/watchlist/:symbol', requireAuth, requireWrite, patchWatchlistHandler);
  app.delete('/api/watchlist/:symbol', requireAuth, requireWrite, removeWatchlistHandler);
  app.post('/api/llm/test', requireAuth, requireWrite, testLlmHandler);
  app.post('/api/datasources/:id/test', requireAuth, requireWrite, testDataSourceHandler);
  app.post('/api/runs', requireAuth, requireWrite, triggerRunHandler);
  app.post('/api/runs/:id/cancel', requireAuth, requireWrite, cancelRunHandler);
  app.post('/api/portfolio/transfer', requireAuth, requireWrite, transferFundsHandler);
  app.post('/api/trades/pending/cancel-bulk', requireAuth, requireWrite, cancelPendingOrdersBulkHandler);
  app.post('/api/trades/pending/:id/cancel', requireAuth, requireWrite, cancelPendingOrderHandler);
  app.post('/api/prices/backfill', requireAuth, requireWrite, triggerBackfillHandler);

  // Backtest routes (require auth, write operations need write permission)
  app.use('/api/backtest', requireAuth, createBacktestRoutes(getDatabase()));

  // Static file serving
  if (options.viteDevMiddleware) {
    app.use(options.viteDevMiddleware);
  } else if (options.staticRoot) {
    app.use(express.static(options.staticRoot));
    app.get('*', (req: Request, res: Response) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(options.staticRoot!, 'index.html'));
      } else {
        res.status(404).json({ error: 'Not Found' });
      }
    });
  }

  // Error middleware
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error('request error', {
      path: req.path,
      method: req.method,
      error: err.message,
    });

    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
        ...(err instanceof ValidationError && err.issues ? { issues: err.issues } : {}),
      });
    } else {
      res.status(500).json({
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
      });
    }
  });

  return app;
}
