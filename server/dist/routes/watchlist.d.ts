import { Request, Response, NextFunction } from 'express';
/** POST /api/symbols/validate — prove a ticker exists by fetching a live quote. */
export declare function validateSymbolHandler(req: Request, res: Response, next: NextFunction): Promise<void>;
/** GET /api/watchlist */
export declare function listWatchlistHandler(_req: Request, res: Response, next: NextFunction): void;
/** GET /api/watchlist/enhanced - includes category, yield, dividend growth, plan status */
export declare function listEnhancedWatchlistHandler(_req: Request, res: Response, next: NextFunction): void;
/** POST /api/watchlist — validate then persist. */
export declare function addWatchlistHandler(req: Request, res: Response, next: NextFunction): Promise<void>;
/** DELETE /api/watchlist/:symbol */
export declare function removeWatchlistHandler(req: Request, res: Response, next: NextFunction): void;
/** PATCH /api/watchlist/:symbol — body { enabled: boolean } */
export declare function patchWatchlistHandler(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=watchlist.d.ts.map