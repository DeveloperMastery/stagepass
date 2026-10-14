import { createApp } from './app.js';
import { expireHolds } from './bookings.js';
import { config } from './config.js';
import { pool } from './db.js';

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${config.port} (booking mode: ${config.bookingMode})`);
});

// Every 30 seconds, release seats whose 10 minute hold ran out.
const expiryTimer = setInterval(async () => {
  try {
    const count = await expireHolds();
    if (count > 0) console.log(`Released ${count} expired hold(s)`);
  } catch (err) {
    console.error('Hold expiry job failed', err);
  }
}, 30_000);

// systemd sends SIGTERM on stop/restart. Finish in-flight requests, then exit.
function shutdown() {
  console.log('Shutting down');
  clearInterval(expiryTimer);
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
