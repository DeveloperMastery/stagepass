import type pg from 'pg';
import { config } from './config.js';
import { pool, withTransaction } from './db.js';
import { HttpError } from './errors.js';

type SeatRow = {
  id: number;
  status: 'available' | 'held' | 'sold';
  price_cents: number;
  hold_expires_at: Date | null;
};

function isFree(seat: SeatRow) {
  // A held seat whose hold ran out is free again, even if the cleanup job hasn't run yet.
  return seat.status === 'available' || (seat.status === 'held' && seat.hold_expires_at !== null && seat.hold_expires_at < new Date());
}

/**
 * Reserve seats for a user: creates a booking in "held" state for HOLD_MINUTES.
 *
 * The important part is SELECT ... FOR UPDATE. It locks the seat rows until this
 * transaction commits. If two people try to reserve the same seat at the same
 * moment, the second one waits at that line, then sees the seat is already held
 * and gets a 409. Without the lock both would see "available" and both would win.
 */
export async function reserveSeats(userId: number, eventId: number, seatIds: number[]) {
  const uniqueSeatIds = [...new Set(seatIds)];
  if (uniqueSeatIds.length === 0) throw new HttpError(400, 'Pick at least one seat');
  if (uniqueSeatIds.length > config.maxSeatsPerBooking) {
    throw new HttpError(400, `You can reserve up to ${config.maxSeatsPerBooking} seats at once`);
  }

  if (config.bookingMode === 'unsafe') {
    return reserveSeatsWithoutLocking(userId, eventId, uniqueSeatIds);
  }

  return withTransaction(async (client) => {
    await assertEventIsUpcoming(client, eventId);

    // Lock the seats. ORDER BY id makes every transaction lock seats in the
    // same order, which prevents deadlocks when two bookings overlap.
    const { rows: seats } = await client.query<SeatRow>(
      `SELECT s.id, s.status, s.price_cents, b.hold_expires_at
         FROM seats s
         LEFT JOIN bookings b ON b.id = s.booking_id
        WHERE s.event_id = $1 AND s.id = ANY($2::bigint[])
        ORDER BY s.id
          FOR UPDATE OF s`,
      [eventId, uniqueSeatIds],
    );

    if (seats.length !== uniqueSeatIds.length) throw new HttpError(404, 'Some seats do not exist for this event');
    if (!seats.every(isFree)) throw new HttpError(409, 'Some of these seats were just taken. Pick other seats.');

    return createHeldBooking(client, userId, eventId, seats);
  });
}

/**
 * The naive version: read the seats, check them, then write. No lock.
 * Between our read and our write another request can read the same seats,
 * so both requests "win" and the seat is sold twice.
 * Only used when BOOKING_MODE=unsafe, to demo the race condition.
 */
async function reserveSeatsWithoutLocking(userId: number, eventId: number, seatIds: number[]) {
  await assertEventIsUpcoming(pool, eventId);

  const { rows: seats } = await pool.query<SeatRow>(
    `SELECT s.id, s.status, s.price_cents, b.hold_expires_at
       FROM seats s
       LEFT JOIN bookings b ON b.id = s.booking_id
      WHERE s.event_id = $1 AND s.id = ANY($2::bigint[])`,
    [eventId, seatIds],
  );

  if (seats.length !== seatIds.length) throw new HttpError(404, 'Some seats do not exist for this event');
  if (!seats.every(isFree)) throw new HttpError(409, 'Some of these seats were just taken. Pick other seats.');

  return withTransaction((client) => createHeldBooking(client, userId, eventId, seats));
}

async function assertEventIsUpcoming(db: pg.Pool | pg.PoolClient, eventId: number) {
  const { rows } = await db.query<{ starts_at: Date }>('SELECT starts_at FROM events WHERE id = $1', [eventId]);
  if (!rows[0]) throw new HttpError(404, 'Event not found');
  if (rows[0].starts_at < new Date()) throw new HttpError(400, 'This event has already started');
}

async function createHeldBooking(client: pg.PoolClient, userId: number, eventId: number, seats: SeatRow[]) {
  const total = seats.reduce((sum, s) => sum + s.price_cents, 0);

  const { rows } = await client.query<{ id: number; hold_expires_at: Date }>(
    `INSERT INTO bookings (user_id, event_id, status, total_cents, hold_expires_at)
     VALUES ($1, $2, 'held', $3, now() + make_interval(mins => $4))
     RETURNING id, hold_expires_at`,
    [userId, eventId, total, config.holdMinutes],
  );
  const booking = rows[0];
  const seatIds = seats.map((s) => s.id);

  await client.query(
    `INSERT INTO booking_seats (booking_id, seat_id, price_cents)
     SELECT $1, s.id, s.price_cents FROM seats s WHERE s.id = ANY($2::bigint[])`,
    [booking.id, seatIds],
  );
  await client.query(
    `UPDATE seats SET status = 'held', booking_id = $1 WHERE id = ANY($2::bigint[])`,
    [booking.id, seatIds],
  );

  return { id: booking.id, status: 'held' as const, totalCents: total, holdExpiresAt: booking.hold_expires_at };
}

/**
 * Confirm (pay for) a held booking. There's no real payment provider here;
 * in a real app you'd charge the card first, then run this.
 */
export async function confirmBooking(userId: number, bookingId: number) {
  return withTransaction(async (client) => {
    // Lock the booking so the expiry job can't expire it while we confirm it.
    const { rows } = await client.query<{ status: string; expired: boolean }>(
      `SELECT status, hold_expires_at < now() AS expired
         FROM bookings
        WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
      [bookingId, userId],
    );
    const booking = rows[0];
    if (!booking) throw new HttpError(404, 'Booking not found');
    if (booking.status === 'confirmed') throw new HttpError(409, 'This booking is already confirmed');
    if (booking.status !== 'held' || booking.expired) {
      throw new HttpError(410, 'Your hold has expired. Please pick your seats again.');
    }

    // Only seats still owned by this booking become sold. In normal operation
    // that's all of them. In unsafe mode another booking may have overwritten
    // some, and then we refuse rather than sell a seat twice.
    const updated = await client.query(
      `UPDATE seats SET status = 'sold' WHERE booking_id = $1 AND status = 'held'`,
      [bookingId],
    );
    const { rows: countRows } = await client.query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM booking_seats WHERE booking_id = $1',
      [bookingId],
    );
    if (config.bookingMode === 'safe' && updated.rowCount !== countRows[0].count) {
      throw new HttpError(409, 'Some of your seats are no longer held. Please pick your seats again.');
    }

    await client.query(`UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [bookingId]);
    return getBooking(client, userId, bookingId);
  });
}

/** Give up a hold before it expires, so the seats go back on sale right away. */
export async function cancelHold(userId: number, bookingId: number) {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [bookingId, userId],
    );
    if (!rows[0]) throw new HttpError(404, 'Booking not found');
    if (rows[0].status !== 'held') throw new HttpError(409, 'Only a held booking can be cancelled');

    await client.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
    await client.query(
      `UPDATE seats SET status = 'available', booking_id = NULL WHERE booking_id = $1 AND status = 'held'`,
      [bookingId],
    );
  });
}

/**
 * Release every hold that ran out. Runs on a timer inside the API process.
 * Safe to run at the same time as confirmBooking: the UPDATE waits for the
 * row lock, then re-checks status = 'held', so a just-confirmed booking is skipped.
 */
export async function expireHolds(): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `UPDATE bookings SET status = 'expired'
        WHERE status = 'held' AND hold_expires_at < now()
        RETURNING id`,
    );
    if (rows.length > 0) {
      await client.query(
        `UPDATE seats SET status = 'available', booking_id = NULL
          WHERE booking_id = ANY($1::bigint[]) AND status = 'held'`,
        [rows.map((r) => r.id)],
      );
    }
    return rows.length;
  });
}

const bookingSelect = `
  SELECT b.id, b.status, b.total_cents AS "totalCents", b.hold_expires_at AS "holdExpiresAt",
         b.confirmed_at AS "confirmedAt", b.created_at AS "createdAt",
         json_build_object(
           'id', e.id, 'title', e.title, 'venue', e.venue, 'city', e.city, 'startsAt', e.starts_at
         ) AS event,
         COALESCE(
           (SELECT json_agg(json_build_object(
                     'id', s.id, 'row', s.row_label, 'number', s.seat_number, 'priceCents', bs.price_cents
                   ) ORDER BY s.row_label, s.seat_number)
              FROM booking_seats bs
              JOIN seats s ON s.id = bs.seat_id
             WHERE bs.booking_id = b.id),
           '[]'
         ) AS seats
    FROM bookings b
    JOIN events e ON e.id = b.event_id`;

export async function getBooking(db: pg.Pool | pg.PoolClient, userId: number, bookingId: number) {
  const { rows } = await db.query(`${bookingSelect} WHERE b.id = $1 AND b.user_id = $2`, [bookingId, userId]);
  if (!rows[0]) throw new HttpError(404, 'Booking not found');
  return rows[0];
}

export async function listBookings(userId: number) {
  // Expired and cancelled holds are noise on "My tickets", so leave them out.
  const { rows } = await pool.query(
    `${bookingSelect} WHERE b.user_id = $1 AND b.status IN ('held', 'confirmed') ORDER BY b.created_at DESC LIMIT 100`,
    [userId],
  );
  return rows;
}
