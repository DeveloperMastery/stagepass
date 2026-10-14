import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';

export const eventsRouter = Router();

const idParam = z.coerce.number().int().positive();

// Upcoming events, with the cheapest price and how many seats are still free.
eventsRouter.get('/', async (req, res) => {
  const city = typeof req.query.city === 'string' && req.query.city.trim() ? req.query.city.trim() : null;

  const { rows } = await pool.query(
    `SELECT e.id, e.title, e.description, e.venue, e.city, e.starts_at AS "startsAt",
            MIN(s.price_cents) AS "minPriceCents",
            COUNT(s.id) AS "totalSeats",
            COUNT(s.id) FILTER (
              WHERE s.status = 'available'
                 OR (s.status = 'held' AND b.hold_expires_at < now())
            ) AS "availableSeats"
       FROM events e
       LEFT JOIN seats s ON s.event_id = e.id
       LEFT JOIN bookings b ON b.id = s.booking_id
      WHERE e.starts_at > now()
        AND ($1::text IS NULL OR e.city ILIKE $1)
      GROUP BY e.id
      ORDER BY e.starts_at
      LIMIT 100`,
    [city],
  );
  res.json({ events: rows });
});

// One event and its full seat map.
eventsRouter.get('/:id', async (req, res) => {
  const id = idParam.parse(req.params.id);

  const eventResult = await pool.query(
    `SELECT e.id, e.title, e.description, e.venue, e.city, e.starts_at AS "startsAt",
            u.name AS "organizerName"
       FROM events e
       JOIN users u ON u.id = e.organizer_id
      WHERE e.id = $1`,
    [id],
  );
  const event = eventResult.rows[0];
  if (!event) throw new HttpError(404, 'Event not found');

  // A hold that has run out counts as available, even if the cleanup job
  // hasn't released it yet.
  const seatsResult = await pool.query(
    `SELECT s.id, s.row_label AS "row", s.seat_number AS "number", s.price_cents AS "priceCents",
            CASE WHEN s.status = 'held' AND b.hold_expires_at < now() THEN 'available'
                 ELSE s.status END AS status
       FROM seats s
       LEFT JOIN bookings b ON b.id = s.booking_id
      WHERE s.event_id = $1
      ORDER BY s.row_label, s.seat_number`,
    [id],
  );

  res.json({ event, seats: seatsResult.rows });
});
