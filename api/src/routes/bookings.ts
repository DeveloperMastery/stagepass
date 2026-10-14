import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { cancelHold, confirmBooking, getBooking, listBookings, reserveSeats } from '../bookings.js';
import { pool } from '../db.js';

export const bookingsRouter = Router();

const idParam = z.coerce.number().int().positive();

const reserveBody = z.object({
  eventId: z.number().int().positive(),
  seatIds: z.array(z.number().int().positive()).min(1),
});

bookingsRouter.post('/', async (req, res) => {
  const user = requireUser(req);
  const body = reserveBody.parse(req.body);
  const booking = await reserveSeats(user.id, body.eventId, body.seatIds);
  res.status(201).json({ booking });
});

bookingsRouter.get('/', async (req, res) => {
  const user = requireUser(req);
  res.json({ bookings: await listBookings(user.id) });
});

bookingsRouter.get('/:id', async (req, res) => {
  const user = requireUser(req);
  res.json({ booking: await getBooking(pool, user.id, idParam.parse(req.params.id)) });
});

bookingsRouter.post('/:id/confirm', async (req, res) => {
  const user = requireUser(req);
  res.json({ booking: await confirmBooking(user.id, idParam.parse(req.params.id)) });
});

bookingsRouter.post('/:id/cancel', async (req, res) => {
  const user = requireUser(req);
  await cancelHold(user.id, idParam.parse(req.params.id));
  res.status(204).end();
});
