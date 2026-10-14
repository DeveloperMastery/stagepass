import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { clearSessionCookie, requireUser, setSessionCookie, type Role } from '../auth.js';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';

export const authRouter = Router();

const registerBody = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  role: z.enum(['customer', 'organizer']).default('customer'),
});

const loginBody = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string(),
});

type UserRow = { id: number; name: string; email: string; role: Role; password_hash: string };

function publicUser(u: Pick<UserRow, 'id' | 'name' | 'email' | 'role'>) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

authRouter.post('/register', async (req, res) => {
  const body = registerBody.parse(req.body);
  const passwordHash = await bcrypt.hash(body.password, 10);

  try {
    const { rows } = await pool.query<UserRow>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role`,
      [body.name, body.email, passwordHash, body.role],
    );
    const user = rows[0];
    setSessionCookie(res, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (err: any) {
    // 23505 = unique_violation: the email is already registered
    if (err?.code === '23505') throw new HttpError(409, 'An account with this email already exists');
    throw err;
  }
});

authRouter.post('/login', async (req, res) => {
  const body = loginBody.parse(req.body);
  const { rows } = await pool.query<UserRow>(
    'SELECT id, name, email, role, password_hash FROM users WHERE email = $1',
    [body.email],
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
    throw new HttpError(401, 'Wrong email or password');
  }
  setSessionCookie(res, user);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', async (req, res) => {
  const { id } = requireUser(req);
  const { rows } = await pool.query<UserRow>('SELECT id, name, email, role FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(401, 'Please log in first');
  res.json({ user: publicUser(rows[0]) });
});
