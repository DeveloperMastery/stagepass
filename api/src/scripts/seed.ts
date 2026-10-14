// Fills an empty database with demo accounts and upcoming events.
// Does nothing if there are already users, so it's safe to run twice.
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from '../db.js';

const ROW_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

type DemoEvent = {
  title: string;
  description: string;
  venue: string;
  city: string;
  daysFromNow: number;
  hour: number;
  // [number of rows, seats per row, price in cents], front rows first
  sections: [number, number, number][];
};

const demoEvents: DemoEvent[] = [
  {
    title: 'The Midnight Quartet: Live',
    description: 'An evening of modern jazz from a quartet that sells out every room it plays. Two sets, one intermission.',
    venue: 'Blue Room Jazz Club',
    city: 'Berlin',
    daysFromNow: 9,
    hour: 20,
    sections: [[2, 10, 6500], [4, 12, 4500]],
  },
  {
    title: 'Backend Summit',
    description: 'One day, one track, eight talks on running systems in production: databases, queues, caching, and incident stories.',
    venue: 'Hall 4, Messe Center',
    city: 'Amsterdam',
    daysFromNow: 21,
    hour: 9,
    sections: [[3, 16, 29900], [7, 16, 19900]],
  },
  {
    title: 'Neon Harbor',
    description: 'Synth-pop band on their first European tour. Doors open one hour before the show.',
    venue: 'The Warehouse',
    city: 'London',
    daysFromNow: 14,
    hour: 21,
    sections: [[3, 14, 5500], [5, 14, 3800]],
  },
  {
    title: 'Stand-up Night: Open Bar Edition',
    description: 'Five comedians, twenty minutes each. Not suitable for anyone who is easily offended by jokes about software engineers.',
    venue: 'Laugh Factory Downtown',
    city: 'Berlin',
    daysFromNow: 5,
    hour: 19,
    sections: [[2, 8, 3000], [4, 10, 2000]],
  },
  {
    title: 'City Symphony: Season Opening',
    description: 'The orchestra opens the season with Dvořák\'s Symphony No. 9 and a world premiere by a local composer.',
    venue: 'Grand Concert Hall',
    city: 'Vienna',
    daysFromNow: 30,
    hour: 19,
    sections: [[2, 18, 12000], [4, 20, 8500], [4, 20, 5000]],
  },
];

export async function seed() {
  const { rows } = await pool.query<{ count: number }>('SELECT COUNT(*) AS count FROM users');
  if (rows[0].count > 0) {
    console.log('Database already has data, skipping seed');
    return;
  }

  await withTransaction(async (client) => {
    const organizerHash = await bcrypt.hash('organizer123', 10);
    const customerHash = await bcrypt.hash('customer123', 10);

    const organizer = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Demo Organizer', 'organizer@stagepass.dev', $1, 'organizer') RETURNING id`,
      [organizerHash],
    );
    await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ('Demo Customer', 'customer@stagepass.dev', $1, 'customer')`,
      [customerHash],
    );

    for (const e of demoEvents) {
      const startsAt = new Date();
      startsAt.setDate(startsAt.getDate() + e.daysFromNow);
      startsAt.setHours(e.hour, 0, 0, 0);

      const event = await client.query<{ id: number }>(
        `INSERT INTO events (organizer_id, title, description, venue, city, starts_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [organizer.rows[0].id, e.title, e.description, e.venue, e.city, startsAt],
      );

      const labels: string[] = [];
      const numbers: number[] = [];
      const prices: number[] = [];
      let rowIndex = 0;
      for (const [rowCount, seatsPerRow, price] of e.sections) {
        for (let r = 0; r < rowCount; r++, rowIndex++) {
          for (let n = 1; n <= seatsPerRow; n++) {
            labels.push(ROW_LABELS[rowIndex]);
            numbers.push(n);
            prices.push(price);
          }
        }
      }
      await client.query(
        `INSERT INTO seats (event_id, row_label, seat_number, price_cents)
         SELECT $1, * FROM unnest($2::text[], $3::int[], $4::int[])`,
        [event.rows[0].id, labels, numbers, prices],
      );
    }
  });

  console.log('Seeded demo data');
  console.log('  Organizer: organizer@stagepass.dev / organizer123');
  console.log('  Customer:  customer@stagepass.dev / customer123');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
