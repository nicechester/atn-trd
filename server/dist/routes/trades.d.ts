import { Request, Response, NextFunction } from 'express';
/** GET /api/trades?limit=50&offset=0 - Get filled orders/trades */
export declare function listTradesHandler(req: Request, res: Response, next: NextFunction): Promise<void>;
/** GET /api/trades/pending */
export declare function listPendingOrdersHandler(_req: Request, res: Response, next: NextFunction): Promise<void>;
/** POST /api/trades/pending/:id/cancel */
export declare function cancelPendingOrderHandler(req: Request, res: Response, next: NextFunction): Promise<void>;
/** POST /api/trades/pending/cancel-bulk */
export declare function cancelPendingOrdersBulkHandler(req: Request, res: Response, next: NextFunction): void;
/** GET /api/trades/:id */
export declare function getTradeHandler(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=trades.d.ts.map