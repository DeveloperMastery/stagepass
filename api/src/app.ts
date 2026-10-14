import cookieParser from 'cookie-parser';
import express from 'express';
import { loadUser } from './auth.js';
import { pool } from './db.js';
import { errorHandler } from './errors.js';
import { authRouter } from './routes/auth.js';
import { bookingsRouter } from './routes/bookings.js';
import { eventsRouter } from './routes/events.js';
import { organizerRouter } from './routes/organizer.js';

export function createApp() {
  const app = express();

  // Nginx sits in front of us, so trust the X-Forwarded-For header it sets.
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadUser);

  // One log line per request: method, path, status, duration.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (process.env.NODE_ENV !== 'test') {
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
      }
    });
    next();
  });

  // Used to check the server is up and can reach the database.
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'database unavailable' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/organizer', organizerRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);
  return app;
}
