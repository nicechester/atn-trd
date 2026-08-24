import express, { Express, Request, Response, NextFunction } from 'express';
import path from 'path';
import { AppError, ValidationError } from './lib/errors.js';
import { logger } from './lib/logger.js';
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

  // JSON body limit config
  app.use(express.json({ limit: '10mb' }));

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug('incoming request', {
      method: req.method,
      path: req.path,
    });
    next();
  });

  // API routes
  app.get('/api/health', healthHandler);
  app.get('/api/settings', getSettingsHandler);
  app.patch('/api/settings', patchSettingsHandler);
  app.get('/api/secrets', getSecretsHandler);
  app.put('/api/secrets/:name', putSecretHandler);
  app.delete('/api/secrets/:name', deleteSecretHandler);
  app.post('/api/symbols/validate', validateSymbolHandler);
  app.get('/api/watchlist', listWatchlistHandler);
  app.post('/api/watchlist', addWatchlistHandler);
  app.patch('/api/watchlist/:symbol', patchWatchlistHandler);
  app.delete('/api/watchlist/:symbol', removeWatchlistHandler);
  app.post('/api/llm/test', testLlmHandler);
  app.get('/api/datasources', listDataSourcesHandler);
  app.post('/api/datasources/:id/test', testDataSourceHandler);
  app.get('/api/scheduler/next-runs', nextRunsHandler);
  app.get('/api/runs', listRunsHandler);
  app.get('/api/runs/:id', getRunHandler);
  app.get('/api/runs/:id/coverage', getRunCoverageHandler);
  app.post('/api/runs', triggerRunHandler);
  app.post('/api/runs/:id/cancel', cancelRunHandler);
  app.get('/api/portfolio', getPortfolioHandler);
  app.get('/api/portfolio/history', getPortfolioHistoryHandler);
  app.post('/api/portfolio/transfer', transferFundsHandler);
  app.get('/api/trades', listTradesHandler);
  app.get('/api/trades/pending', listPendingOrdersHandler);
  app.post('/api/trades/pending/cancel-bulk', cancelPendingOrdersBulkHandler);
  app.post('/api/trades/pending/:id/cancel', cancelPendingOrderHandler);
  app.get('/api/trades/:id', getTradeHandler);
  app.get('/api/calibration', getCalibrationHandler);
  app.get('/api/performance', getPerformanceHandler);
  app.get('/api/runs/progress/stream', runProgressStreamHandler);
  app.get('/api/prices/symbols', listTrackedSymbolsHandler);
  app.post('/api/prices/backfill', triggerBackfillHandler);

  // Backtest routes
  app.use('/api/backtest', createBacktestRoutes(getDatabase()));

  // Static file serving
  if (options.viteDevMiddleware) {
    // Dev mode: use Vite middleware
    app.use(options.viteDevMiddleware);
  } else if (options.staticRoot) {
    // Production mode: serve built static files
    app.use(express.static(options.staticRoot));

    // Catch-all for SPA: return index.html for non-API GET requests
    app.get('*', (req: Request, res: Response) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(options.staticRoot!, 'index.html'));
      } else {
        res.status(404).json({ error: 'Not Found' });
      }
    });
  }

  // Error middleware: map typed errors to HTTP status codes
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
        ...(err instanceof ValidationError && err.issues
          ? { issues: err.issues }
          : {}),
      });
    } else {
      // Fallback for unexpected errors
      res.status(500).json({
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
      });
    }
  });

  return app;
}
