import { Request, Response, NextFunction } from 'express';
/** GET /api/runs?limit=50&offset=0 */
export declare function listRunsHandler(req: Request, res: Response, next: NextFunction): void;
/** GET /api/runs/:id */
export declare function getRunHandler(req: Request, res: Response, next: NextFunction): void;
/** GET /api/runs/:id/coverage */
export declare function getRunCoverageHandler(req: Request, res: Response, next: NextFunction): void;
/** POST /api/runs */
export declare function triggerRunHandler(_req: Request, res: Response, next: NextFunction): Promise<void>;
/** GET /api/runs/:id/coverage */
export declare function getCoverageHandler(req: Request, res: Response, next: NextFunction): void;
/** POST /api/runs/:id/cancel */
export declare function cancelRunHandler(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=runs.d.ts.map