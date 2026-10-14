import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { expireHolds } from '../src/bookings.js';
import { pool } from '../src/db.js';
import { migrate } from '../src/scripts/migrate.js';

const app = createApp();
let n = 0;

async function signUp(role: 'customer' | 'organizer' = 'customer') {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register')
    .send({ name: `User ${++n}`, email: `user${n}-${Date.now()}@example.com`, password: 'password123', role });
  expect(res.status).toBe(201);
  return agent;
}

async function createEvent(organizer: ReturnType<typeof request.agent>) {
  const startsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const res = await organizer.post('/api/organizer/events').send({
    title: 'Test Concert',
    venue: 'Test Hall',
    city: 'Berlin',
    startsAt,
    rows: [
      { seats: 4, priceCents: 5000 },
      { seats: 4, priceCents: 3000 },
    ],
  });
  expect(res.status).toBe(201);
  const detail = await request(app).get(`/api/events/${res.body.event.id}`);
  return { eventId: res.body.event.id as number, seats: detail.body.seats as { id: number; status: string; priceCents: number }[] };
}

async function seatStatus(eventId: number, seatId: number) {
  const res = await request(app).get(`/api/events/${eventId}`);
  return res.body.seats.find((s: any) => s.id === seatId).status;
}

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
});

beforeEach(async () => {
  await pool.query('TRUNCATE booking_seats, seats, bookings, events, users RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('auth', () => {
  it('registers, returns the user from /me, and rejects a duplicate email', async () => {
    const agent = request.agent(app);
    const email = 'dup@example.com';
    await agent.post('/api/auth/register').send({ name: 'A', email, password: 'password123' }).expect(201);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.user.role).toBe('customer');
    await request(app).post('/api/auth/register').send({ name: 'B', email, password: 'password123' }).expect(409);
  });

  it('rejects a wrong password', async () => {
    await request(app).post('/api/auth/register').send({ name: 'A', email: 'a@example.com', password: 'password123' });
    await request(app).post('/api/auth/login').send({ email: 'a@example.com', password: 'nope' }).expect(401);
  });

  it('requires login to book', async () => {
    await request(app).post('/api/bookings').send({ eventId: 1, seatIds: [1] }).expect(401);
  });
});

describe('events', () => {
  it('lets organizers create events with a seat map, and blocks customers', async () => {
    const organizer = await signUp('organizer');
    const { seats } = await createEvent(organizer);
    expect(seats).toHaveLength(8);
    expect(seats.filter((s) => s.priceCents === 5000)).toHaveLength(4);

    const customer = await signUp();
    await customer.post('/api/organizer/events').send({}).expect(403);
  });
});

describe('booking', () => {
  it('holds seats, then confirms them as sold', async () => {
    const { eventId, seats } = await createEvent(await signUp('organizer'));
    const customer = await signUp();

    const hold = await customer.post('/api/bookings').send({ eventId, seatIds: [seats[0].id, seats[1].id] }).expect(201);
    expect(hold.body.booking.status).toBe('held');
    expect(hold.body.booking.totalCents).toBe(10000);
    expect(await seatStatus(eventId, seats[0].id)).toBe('held');

    const confirmed = await customer.post(`/api/bookings/${hold.body.booking.id}/confirm`).expect(200);
    expect(confirmed.body.booking.status).toBe('confirmed');
    expect(confirmed.body.booking.seats).toHaveLength(2);
    expect(await seatStatus(eventId, seats[0].id)).toBe('sold');

    const mine = await customer.get('/api/bookings').expect(200);
    expect(mine.body.bookings).toHaveLength(1);
  });

  it('rejects a seat someone else is holding', async () => {
    const { eventId, seats } = await createEvent(await signUp('organizer'));
    const alice = await signUp();
    const bob = await signUp();

    await alice.post('/api/bookings').send({ eventId, seatIds: [seats[0].id] }).expect(201);
    await bob.post('/api/bookings').send({ eventId, seatIds: [seats[0].id, seats[1].id] }).expect(409);
    // Bob's failed attempt must not have held seat 2 either
    expect(await seatStatus(eventId, seats[1].id)).toBe('available');
  });

  it('does not let another user confirm my booking', async () => {
    const { eventId, seats } = await createEvent(await signUp('organizer'));
    const alice = await signUp();
    const bob = await signUp();
    const hold = await alice.post('/api/bookings').send({ eventId, seatIds: [seats[0].id] }).expect(201);
    await bob.post(`/api/bookings/${hold.body.booking.id}/confirm`).expect(404);
  });

  it('releases seats when a hold is cancelled', async () => {
    const { eventId, seats } = await createEvent(await signUp('organizer'));
    const customer = await signUp();
    const hold = await customer.post('/api/bookings').send({ eventId, seatIds: [seats[0].id] }).expect(201);
    await customer.post(`/api/bookings/${hold.body.booking.id}/cancel`).expect(204);
    expect(await seatStatus(eventId, seats[0].id)).toBe('available');
  });

  it('expires holds that ran out: no confirming, seats go back on sale', async () => {
    const { eventId, seats } = await createEvent(await signUp('organizer'));
    const alice = await signUp();
    const bob = await signUp();

    const hold = await alice.post('/api/bookings').send({ eventId, seatIds: [seats[0].id] }).expect(201);
    await pool.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [hold.body.booking.id]);

    // Shows as available even before the cleanup job runs
    expect(await seatStatus(eventId, seats[0].id)).toBe('available');
    await alice.post(`/api/bookings/${hold.body.booking.id}/confirm`).expect(410);

    expect(await expireHolds()).toBe(1);
    const { rows } = await pool.query('SELECT status FROM bookings WHERE id = $1', [hold.body.booking.id]);
    expect(rows[0].status).toBe('expired');

    await bob.post('/api/bookings').send({ eventId, seatIds: [seats[0].id] }).expect(201);
  });

  it('gives one seat to exactly one user when many reserve it at the same time', async () => {
    const { eventId, seats } = await createEvent(await signUp('organizer'));
    const users = await Promise.all(Array.from({ length: 20 }, () => signUp()));

    const results = await Promise.all(
      users.map((u) => u.post('/api/bookings').send({ eventId, seatIds: [seats[0].id] })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);
  });
});
