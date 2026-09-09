/**
 * Cloud Scheduler trigger endpoints.
 * These endpoints are called by Cloud Scheduler with OIDC authentication.
 * Also supports manual triggers for each job type.
 */
import { Request, Response, NextFunction } from 'express';
import { resolveExecutionOrder } from '@atn-trd/shared';
/**
 * Validate selected job IDs and return execution order with error handling.
 * @param jobIds - Array of job IDs to validate
 * @returns Object with valid flag and execution order or error message
 */
export declare function validateJobSelection(jobIds: unknown): {
    valid: boolean;
    executionOrder?: ReturnType<typeof resolveExecutionOrder>;
    error?: string;
};
/**
 * Verify Cloud Scheduler OIDC token.
 * In production, validates the Authorization header contains a valid OIDC token
 * from Cloud Scheduler's service account.
 */
export declare function verifySchedulerAuth(req: Request, res: Response, next: NextFunction): void;
/** POST /api/trigger/trading-cycle - Called by Cloud Scheduler */
export declare function triggerTradingCycleHandler(_req: Request, res: Response, next: NextFunction): Promise<void>;
/** POST /api/trigger/snapshot - Called by Cloud Scheduler */
export declare function triggerSnapshotHandler(_req: Request, res: Response, next: NextFunction): Promise<void>;
/** POST /api/trigger/signal-collection - Manual trigger for signal collection */
export declare function triggerSignalCollectionHandler(_req: Request, res: Response, next: NextFunction): Promise<void>;
/** POST /api/trigger/plan-review - Manual trigger for plan review */
export declare function triggerPlanReviewHandler(_req: Request, res: Response, next: NextFunction): Promise<void>;
/** POST /api/trigger/tranche-execution - Manual trigger for tranche execution */
export declare function triggerTrancheExecutionHandler(_req: Request, res: Response, next: NextFunction): Promise<void>;
/** POST /api/trigger/watchlist-curation - Manual trigger to run screener and populate watchlist */
export declare function triggerWatchlistCurationHandler(_req: Request, res: Response, next: NextFunction): Promise<void>;
/** POST /api/trigger/backfill-sectors - One-time backfill of sector data from Finnhub */
export declare function triggerBackfillSectorsHandler(_req: Request, res: Response, next: NextFunction): Promise<void>;
/** POST /api/trigger/run-selected - Selective job execution */
export declare function triggerRunSelectedHandler(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=trigger.d.ts.map