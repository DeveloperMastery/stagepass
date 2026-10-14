import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { HttpError } from './errors.js';

export type Role = 'customer' | 'organizer';
export type AuthUser = { id: number; role: Role };

const COOKIE_NAME = 'stagepass_session';
const SESSION_DAYS = 7;

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// The session is a signed token in a cookie. Nothing is stored in server memory,
// so any server that has JWT_SECRET can check it.
export function setSessionCookie(res: Response, user: AuthUser) {
  const token = jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    expiresIn: `${SESSION_DAYS}d`,
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME);
}

// Reads the session cookie if there is one. Never rejects the request.
export function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
      req.user = { id: Number(payload.sub), role: payload.role as Role };
    } catch {
      // Expired or tampered token: treat as logged out.
    }
  }
  next();
}

export function requireUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Please log in first');
  return req.user;
}

export function requireOrganizer(req: Request): AuthUser {
  const user = requireUser(req);
  if (user.role !== 'organizer') throw new HttpError(403, 'Only organizers can do this');
  return user;
}
