/**
 * Authentication routes: login, logout, me
 */
import { Request, Response, NextFunction } from 'express';
/** POST /api/auth/login */
export declare function loginHandler(req: Request, res: Response, next: NextFunction): void;
/** POST /api/auth/logout */
export declare function logoutHandler(_req: Request, res: Response): void;
/** GET /api/auth/me - Get current user info */
export declare function meHandler(req: Request, res: Response): void;
//# sourceMappingURL=auth.d.ts.map