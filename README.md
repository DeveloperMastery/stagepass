# Stagepass

A ticketing app for live events, like a small Ticketmaster or Eventbrite. Organizers create events with a seat map. Customers pick seats, get them held for 10 minutes, and pay before the hold runs out.

In this exercise you run the whole app on **one server**: the frontend, the backend, and the database all on the same machine.

![Seat map](docs/seat-map.png)

## What the app does

- Browse upcoming events, each with a venue, date, and a seat map with price tiers
- Pick up to 6 seats and reserve them. They're held for you for 10 minutes
- Pay (a fake payment button) and the seats become yours. They show up under "My tickets"
- If you don't pay in time, the hold expires and the seats go back on sale
- Organizers create events, set up rows and prices, and see tickets sold and revenue per event

## How it runs on one server

```mermaid
flowchart LR
    Browser -- "http :80" --> Nginx
    subgraph server["One Ubuntu server"]
        Nginx -- "static files" --> Files["/var/www/stagepass<br/>(built React app)"]
        Nginx -- "/api/* → 127.0.0.1:3000" --> API["Node.js API<br/>(systemd service)"]
        API -- "localhost:5432" --> DB[("PostgreSQL")]
    end
```

There are three separate programs running on the same machine:

1. **Nginx** is the only thing open to the internet, on port 80. It sends the React files to the browser, and forwards every request that starts with `/api` to the Node.js API.
2. **The API** (Node.js, Express, TypeScript) handles login, events, and bookings. It listens on `127.0.0.1:3000`, so only programs on this server can reach it. `systemd` keeps it running and restarts it if it crashes.
3. **PostgreSQL** stores users, events, seats, and bookings. It only listens on `localhost`, so it can't be reached from the internet either.

## What's in the repo

| Folder | What it is |
| --- | --- |
| `web/` | React frontend (Vite, TypeScript) |
| `api/` | Node.js API (Express, TypeScript, `pg`) |
| `api/migrations/` | The database schema, as SQL |
| `api/src/bookings.ts` | The booking logic: holds, payment, expiry. The most interesting file |
| `deploy/` | Nginx config, systemd service, `setup.sh` that installs everything, and `share-database.sh` for running on more than one server |

---

## Deploy it

Two guides, in order:

1. **[DEPLOY.md](DEPLOY.md)**: run the whole app on one server on AWS, Azure, or Google Cloud
2. **[SCALE.md](SCALE.md)**: add a second server and a load balancer in front

Short version, on a fresh Ubuntu 24.04 server:

```bash
sudo git clone https://github.com/DeveloperMastery/stagepass.git /opt/stagepass
sudo /opt/stagepass/deploy/setup.sh
```

Then open `http://<your-server-ip>` and log in with a demo account:

- Customer: `customer@stagepass.dev` / `customer123`
- Organizer: `organizer@stagepass.dev` / `organizer123`

---

## Experiment: sell one seat twice

The hardest part of a ticketing system: two people click the last seat at the same moment. Both requests read the seat, both see "available", and both write "held". Now one seat has two owners.

This app prevents it with a database transaction and a row lock (`SELECT ... FOR UPDATE` in `api/src/bookings.ts`). The first request locks the seat row. The second request waits until the first one commits, then sees the seat is already held and gets a `409`.

`npm run race-test` creates 50 users and sends 50 reserve requests for the same seat at the same time. Run it on the server:

```bash
cd /opt/stagepass/api
npm run race-test
```

```
  201     1  reserved the seat
  409    49  rejected, seat taken

PASS: exactly one user got the seat.
```

Now turn the lock off. `BOOKING_MODE=unsafe` switches to the naive version: read the seat, check it, then write, with no lock.

```bash
sudo sed -i 's/BOOKING_MODE=safe/BOOKING_MODE=unsafe/' /etc/stagepass/api.env
sudo systemctl restart stagepass-api
npm run race-test
```

```
  201     9  reserved the seat
  409    41  rejected, seat taken

FAIL: 9 different users were told seat A2 is theirs. One seat, 9 owners.
```

The exact number changes every run. Switch back when you're done:

```bash
sudo sed -i 's/BOOKING_MODE=unsafe/BOOKING_MODE=safe/' /etc/stagepass/api.env
sudo systemctl restart stagepass-api
```

---

## Run it on more than one server

See [SCALE.md](SCALE.md). Extra servers don't get their own database: `deploy/share-database.sh` on the first server prints the `setup.sh --database-url ... --jwt-secret ...` command to run on each new one.

## Update after changes

```bash
cd /opt/stagepass
sudo git pull
sudo ./deploy/setup.sh
```

The script is safe to run again. It keeps your database and config, rebuilds the code, applies new migrations, and restarts the API.

## Troubleshooting

See [DEPLOY.md](DEPLOY.md#if-something-doesnt-work).

## Run it on your laptop (optional)

You need Node.js 20+ and PostgreSQL running locally.

```bash
# Create a database
createuser stagepass --pwprompt     # use "stagepass" as the password
createdb -O stagepass stagepass

# API on http://localhost:3000
cd api
npm install
export DATABASE_URL=postgres://stagepass:stagepass@localhost:5432/stagepass
export JWT_SECRET=dev-secret
npm run migrate:dev
npm run seed:dev
npm run dev

# In a second terminal: frontend on http://localhost:5173
cd web
npm install
npm run dev
```

The API has integration tests that run against a real database. Create a separate `stagepass_test` database first, because the tests wipe it:

```bash
createdb -O stagepass stagepass_test
cd api && npm test
```

## When you're done

Delete the server. [DEPLOY.md](DEPLOY.md#when-youre-done) shows how on each cloud.
