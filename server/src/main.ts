import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase, closeDatabase } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './app.js';
import { startScheduler, stopScheduler } from './scheduler/index.js';
import { logger } from './lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '8080', 10);
const DATA_DIR = process.env.ATN_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const ATN_ROLE = (process.env.ATN_ROLE || 'all') as 'all' | 'web' | 'worker';
const VITE_DEV = process.env.ATN_VITE_DEV === '1';

async function main(): Promise<void> {
  try {
    logger.info('Starting ATN server', { role: ATN_ROLE, port: PORT });

    // Initialize database
    const db = initializeDatabase(DATA_DIR);
    logger.info('Database initialized', { path: DATA_DIR });

    // Run migrations before starting the server
    const migrationsDir = path.join(__dirname, 'db', 'migrations');
    runMigrations(db, migrationsDir);
    logger.info('Migrations complete');

    // Start Express when role is 'all' or 'web'
    if (ATN_ROLE === 'all' || ATN_ROLE === 'web') {
      let staticRoot: string | undefined;
      let viteDevMiddleware: any;

      if (VITE_DEV) {
        // Dev mode: load Vite middleware
        try {
          const { createServer } = await import('vite');
          const vite = await createServer({
            appType: 'spa',
          } as any);
          viteDevMiddleware = vite.middlewares;
          logger.info('Vite dev middleware loaded');
        } catch (err) {
          logger.error('Failed to load Vite dev middleware', { error: String(err) });
          throw err;
        }
      } else {
        // Production mode: use built static files
        staticRoot = path.join(__dirname, '..', 'public');
      }

      const app = createApp({ staticRoot, viteDevMiddleware });

      app.listen(PORT, () => {
        logger.info('Express server listening', { port: PORT });
      });
    }

    // Start scheduler when role is 'all' or 'worker'
    if (ATN_ROLE === 'all' || ATN_ROLE === 'worker') {
      startScheduler();
    }

    // Graceful shutdown
    const signals = ['SIGTERM', 'SIGINT'];
    signals.forEach((sig) => {
      process.on(sig, async () => {
        logger.info('Received signal, shutting down', { signal: sig });
        stopScheduler();
        closeDatabase();
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error('Fatal error during startup', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// Global handlers for uncaught errors - log and continue rather than crash
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

main();
