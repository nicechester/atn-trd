import { Request, Response, NextFunction } from 'express';
/** GET /api/plans - List all plans (active + paused) */
export declare function listPlansHandler(_req: Request, res: Response, next: NextFunction): void;
/** GET /api/plans/:id - Get plan detail with tranches */
export declare function getPlanHandler(req: Request, res: Response, next: NextFunction): void;
/** GET /api/regime/current - Get current market regime with streak */
export declare function getCurrentRegimeHandler(_req: Request, res: Response, next: NextFunction): void;
/** GET /api/signals/:symbol - Get signal history for a symbol */
export declare function getSignalHistoryHandler(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=plans.d.ts.map