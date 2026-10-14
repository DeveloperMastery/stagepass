// Race condition test: N different users try to reserve the SAME seat at the same moment.
// Correct result: exactly 1 succeeds, everyone else gets 409.
//
// Usage:
//   npm run race-test                                  (50 users, against http://localhost)
//   npm run race-test -- --users 100 --url http://<your-server-ip>

const args = process.argv.slice(2);
function arg(name: string, fallback: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const baseUrl = arg('url', 'http://localhost').replace(/\/$/, '');
const userCount = Number(arg('users', '50'));

async function request(path: string, init: RequestInit & { cookie?: string } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.cookie ? { Cookie: init.cookie } : {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function createUser(i: number, runId: string): Promise<string> {
  const res = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: `Race User ${i}`, email: `race-${runId}-${i}@example.com`, password: 'race-test-password' }),
  });
  if (res.status !== 201) throw new Error(`Could not create test user: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('No session cookie returned');
  return cookie.split(';')[0];
}

async function main() {
  console.log(`Target: ${baseUrl}`);

  const { body: list } = await request('/api/events');
  const event = list.events.find((e: any) => e.availableSeats > 0);
  if (!event) throw new Error('No event with free seats. Run the seed first.');

  const { body: detail } = await request(`/api/events/${event.id}`);
  const seat = detail.seats.find((s: any) => s.status === 'available');
  console.log(`Event: "${event.title}", seat ${seat.row}${seat.number}`);

  // Create the users first, a few at a time, so the race itself is just the reserve calls.
  console.log(`Creating ${userCount} test users...`);
  const runId = Date.now().toString(36);
  const cookies: string[] = [];
  for (let i = 0; i < userCount; i += 10) {
    const batch = Array.from({ length: Math.min(10, userCount - i) }, (_, j) => createUser(i + j, runId));
    cookies.push(...(await Promise.all(batch)));
  }

  console.log(`Firing ${userCount} reserve requests for the same seat at once...`);
  const results = await Promise.all(
    cookies.map((cookie) =>
      request('/api/bookings', {
        method: 'POST',
        cookie,
        body: JSON.stringify({ eventId: event.id, seatIds: [seat.id] }),
      }),
    ),
  );

  const byStatus = new Map<number, number>();
  for (const r of results) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const winners = byStatus.get(201) ?? 0;

  console.log('');
  for (const [status, count] of [...byStatus].sort()) {
    const label = status === 201 ? 'reserved the seat' : status === 409 ? 'rejected, seat taken' : 'other';
    console.log(`  ${String(status).padEnd(4)} ${String(count).padStart(4)}  ${label}`);
  }
  console.log('');

  if (winners === 1) {
    console.log('PASS: exactly one user got the seat.');
  } else {
    console.log(`FAIL: ${winners} different users were told seat ${seat.row}${seat.number} is theirs. One seat, ${winners} owners.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
