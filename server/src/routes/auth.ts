/**
 * Authentication routes: login, logout, me
 */

import { Request, Response, NextFunction } from 'express';
import { authenticate, generateToken } from '../lib/auth.js';

/** POST /api/auth/login */
export function loginHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }
    
    const user = authenticate(username, password);
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    
    const token = generateToken(user);
    
    // Set HTTP-only cookie for browser
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    
    res.json({
      ok: true,
      user: { username: user.username, role: user.role },
      token, // Also return token for API clients
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/logout */
export function logoutHandler(_req: Request, res: Response): void {
  res.clearCookie('token');
  res.json({ ok: true });
}

/** GET /api/auth/me - Get current user info */
export function meHandler(req: Request, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  
  res.json({
    ok: true,
    user: { username: req.user.username, role: req.user.role },
  });
}
