/**
 * Express middleware for authentication and authorization.
 */
import { verifyToken, canWrite } from '../lib/auth.js';
/**
 * Require authentication. Extracts JWT from Authorization header or cookie.
 */
export function requireAuth(req, res, next) {
    const token = extractToken(req);
    if (!token) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const payload = verifyToken(token);
    if (!payload) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
    }
    req.user = payload;
    next();
}
/**
 * Require write permission (chester role only).
 * Must be used after requireAuth.
 */
export function requireWrite(req, res, next) {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    if (!canWrite(req.user.role)) {
        res.status(403).json({ error: 'Write permission required' });
        return;
    }
    next();
}
/**
 * Optional auth - attaches user if token present, but doesn't require it.
 */
export function optionalAuth(req, _res, next) {
    const token = extractToken(req);
    if (token) {
        const payload = verifyToken(token);
        if (payload) {
            req.user = payload;
        }
    }
    next();
}
function extractToken(req) {
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }
    // Check cookie
    const cookie = req.cookies?.token;
    if (cookie) {
        return cookie;
    }
    return null;
}
//# sourceMappingURL=auth.js.map