/**
 * Authentication service with JWT tokens.
 * Users: chester (read/write), guest (read-only)
 * Passwords loaded from environment variables.
 */
import jwt from 'jsonwebtoken';
import { logger } from './logger.js';
const log = logger.child({ component: 'auth' });
// JWT secret - use ATN_ENC_KEY or generate random for dev
const JWT_SECRET = process.env.ATN_ENC_KEY || 'dev-jwt-secret-change-me';
const JWT_EXPIRES_IN = '7d';
// User passwords from environment
function getUsers() {
    const users = new Map();
    const chesterPassword = process.env.AUTH_PASSWORD_CHESTER;
    const guestPassword = process.env.AUTH_PASSWORD_GUEST;
    if (chesterPassword) {
        users.set('chester', { password: chesterPassword, role: 'chester' });
    }
    if (guestPassword) {
        users.set('guest', { password: guestPassword, role: 'guest' });
    }
    // Fallback for development
    if (users.size === 0 && process.env.NODE_ENV !== 'production') {
        log.warn('No auth passwords configured, using dev defaults');
        users.set('chester', { password: 'chester', role: 'chester' });
        users.set('guest', { password: 'guest', role: 'guest' });
    }
    return users;
}
export function authenticate(username, password) {
    const users = getUsers();
    const user = users.get(username.toLowerCase());
    if (!user || user.password !== password) {
        return null;
    }
    return { username: username.toLowerCase(), role: user.role };
}
export function generateToken(user) {
    return jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}
export function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    }
    catch {
        return null;
    }
}
export function canWrite(role) {
    return role === 'chester';
}
//# sourceMappingURL=auth.js.map