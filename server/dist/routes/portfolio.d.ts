import { Request, Response, NextFunction } from 'express';
/** GET /api/portfolio */
export declare function getPortfolioHandler(_req: Request, res: Response, next: NextFunction): Promise<void>;
/** GET /api/portfolio/history?limit=30 */
export declare function getPortfolioHistoryHandler(req: Request, res: Response, next: NextFunction): void;
/** POST /api/portfolio/init — initialize portfolio with seed money */
export declare function initPortfolioHandler(req: Request, res: Response, next: NextFunction): void;
/** POST /api/portfolio/transfer — deposit or withdraw cash */
export declare function transferFundsHandler(req: Request, res: Response, next: NextFunction): void;
/** POST /api/portfolio/reset — reset portfolio to initial state */
export declare function resetPortfolioHandler(req: Request, res: Response, next: NextFunction): void;
/** POST /api/portfolio/order — place manual order on paper trader */
export declare function manualOrderHandler(req: Request, res: Response, next: NextFunction): Promise<void>;
/** GET /api/portfolio/market-status — check if market is open */
export declare function marketStatusHandler(_req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=portfolio.d.ts.map