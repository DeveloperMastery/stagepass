import { Router } from 'express';
import { z } from 'zod';
import { requireOrganizer } from '../auth.js';
import { pool, withTransaction } from '../db.js';

export const organizerRouter = Router();

const ROW_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const createEventBody = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(2000).default(''),
  venue: z.string().trim().min(2).max(150),
  city: z.string().trim().min(2).max(100),
  startsAt: z.coerce.date().refine((d) => d > new Date(), 'must be in the future'),
  // One entry per row of seats, front row first. Up to 26 rows (A to Z).
  rows: z
    .array(
      z.object({
        seats: z.number().int().min(1).max(40),
        priceCents: z.number().int().min(0).max(10_000_00),
      }),
    )
    .min(1)
    .max(ROW_LABELS.length),
});

organizerRouter.post('/events', async (req, res) => {
  const organizer = requireOrganizer(req);
  const body = createEventBody.parse(req.body);

  // The event and all its seats are created together, or not at all.
  const eventId = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO events (organizer_id, title, description, venue, city, starts_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [organizer.id, body.title, body.description, body.venue, body.city, body.startsAt],
    );
    const id = rows[0].id;

    const labels: string[] = [];
    const numbers: number[] = [];
    const prices: number[] = [];
    body.rows.forEach((row, i) => {
      for (let n = 1; n <= row.seats; n++) {
        labels.push(ROW_LABELS[i]);
        numbers.push(n);
        prices.push(row.priceCents);
      }
    });

    // One INSERT for all seats instead of one query per seat.
    await client.query(
      `INSERT INTO seats (event_id, row_label, seat_number, price_cents)
       SELECT $1, * FROM unnest($2::text[], $3::int[], $4::int[])`,
      [id, labels, numbers, prices],
    );
    return id;
  });

  res.status(201).json({ event: { id: eventId } });
});

// The organizer's dashboard: every event with seats sold, held, and revenue.
organizerRouter.get('/events', async (req, res) => {
  const organizer = requireOrganizer(req);
  const { rows } = await pool.query(
    `SELECT e.id, e.title, e.venue, e.city, e.starts_at AS "startsAt",
            COUNT(s.id) AS "totalSeats",
            COUNT(s.id) FILTER (WHERE s.status = 'sold') AS "soldSeats",
            COUNT(s.id) FILTER (WHERE s.status = 'held' AND b.hold_expires_at >= now()) AS "heldSeats",
            COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'sold'), 0) AS "revenueCents"
       FROM events e
       LEFT JOIN seats s ON s.event_id = e.id
       LEFT JOIN bookings b ON b.id = s.booking_id
      WHERE e.organizer_id = $1
      GROUP BY e.id
      ORDER BY e.starts_at`,
    [organizer.id],
  );
  res.json({ events: rows });
});
