/**
 * Authentication service with JWT tokens.
 * Users: chester (read/write), guest (read-only)
 * Passwords loaded from environment variables.
 */
export type Role = 'chester' | 'guest';
export interface User {
    username: string;
    role: Role;
}
export interface JwtPayload {
    username: string;
    role: Role;
    iat: number;
    exp: number;
}
export declare function authenticate(username: string, password: string): User | null;
export declare function generateToken(user: User): string;
export declare function verifyToken(token: string): JwtPayload | null;
export declare function canWrite(role: Role): boolean;
//# sourceMappingURL=auth.d.ts.map