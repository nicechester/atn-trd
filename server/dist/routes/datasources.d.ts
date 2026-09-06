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
import { type DataSourceRegistry } from '../datasources/registry.js';
export interface DataSourcesRouteDeps {
    registry?: DataSourceRegistry;
}
export declare function createListDataSourcesHandler(deps?: DataSourcesRouteDeps): (_req: Request, res: Response, next: NextFunction) => void;
export declare function createTestDataSourceHandler(deps?: DataSourcesRouteDeps): (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const listDataSourcesHandler: (_req: Request, res: Response, next: NextFunction) => void;
export declare const testDataSourceHandler: (req: Request, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=datasources.d.ts.map