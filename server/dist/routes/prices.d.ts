import { Request, Response, NextFunction } from 'express';
/** POST /api/prices/backfill - Trigger price data backfill */
export declare function triggerBackfillHandler(req: Request, res: Response, next: NextFunction): Promise<void>;
/** GET /api/prices/symbols - List all tracked symbols (watchlist + static) */
export declare function listTrackedSymbolsHandler(_req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=prices.d.ts.map