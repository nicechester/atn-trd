/**
 * Express middleware for authentication and authorization.
 */
import { Request, Response, NextFunction } from 'express';
import { type JwtPayload } from '../lib/auth.js';
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}
/**
 * Require authentication. Extracts JWT from Authorization header or cookie.
 */
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
/**
 * Require write permission (chester role only).
 * Must be used after requireAuth.
 */
export declare function requireWrite(req: Request, res: Response, next: NextFunction): void;
/**
 * Optional auth - attaches user if token present, but doesn't require it.
 */
export declare function optionalAuth(req: Request, _res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map