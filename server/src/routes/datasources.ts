/**
 * Data source status and connectivity endpoints.
 *
 *   GET  /api/datasources            — id / provider / configured / enabled
 *   POST /api/datasources/:id/test   — live health check for one source
 *
 * The test endpoint is the Phase 1 vertical slice: it runs a real (cheap)
 * request against the provider. It never 500s on an upstream failure — a dead
 * provider is reported as `{ ok: false, detail }` with HTTP 200, because "the
 * provider is down" is a successful answer to "is the provider up?".
 */

import { Request, Response, NextFunction } from 'express';
import { isDataSourceId, DATA_SOURCE_IDS, type DataSourceId } from '../datasources/types.js';
import { dataSourceRegistry, type DataSourceRegistry } from '../datasources/registry.js';
import { NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'datasources-route' });

export interface DataSourcesRouteDeps {
  registry?: DataSourceRegistry;
}

function parseId(req: Request): DataSourceId {
  const { id } = req.params;
  if (!isDataSourceId(id)) {
    throw new NotFoundError(
      `Unknown data source "${String(id)}". Expected one of: ${DATA_SOURCE_IDS.join(', ')}`
    );
  }
  return id;
}

export function createListDataSourcesHandler(deps: DataSourcesRouteDeps = {}) {
  const registry = deps.registry ?? dataSourceRegistry;

  /** GET /api/datasources */
  return function listDataSourcesHandler(
    _req: Request,
    res: Response,
    next: NextFunction
  ): void {
    try {
      res.json({ ok: true, data: registry.list() });
    } catch (err) {
      next(err);
    }
  };
}

export function createTestDataSourceHandler(deps: DataSourcesRouteDeps = {}) {
  const registry = deps.registry ?? dataSourceRegistry;

  /** POST /api/datasources/:id/test */
  return async function testDataSourceHandler(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    let id: DataSourceId;
    try {
      id = parseId(req);
    } catch (err) {
      next(err);
      return;
    }

    try {
      const health = await registry.test(id);
      log.info('data source test', {
        id,
        provider: health.provider,
        ok: health.ok,
        latencyMs: health.latencyMs,
      });
      res.json({
        ok: health.ok,
        id,
        name: health.name,
        provider: health.provider,
        configured: health.configured,
        detail: health.detail,
        latencyMs: health.latencyMs,
        checkedAt: health.checkedAt,
      });
    } catch (err) {
      // `healthCheck` is contractually non-throwing; reaching here means the
      // registry itself failed. Degrade rather than crash the request.
      const message = err instanceof Error ? err.message : String(err);
      log.error('data source test failed unexpectedly', { id, error: message });
      res.json({ ok: false, id, detail: message, latencyMs: null, checkedAt: Date.now() });
    }
  };
}

export const listDataSourcesHandler = createListDataSourcesHandler();
export const testDataSourceHandler = createTestDataSourceHandler();
