-- Users can be customers (buy tickets) or organizers (create events).
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'organizer')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id           BIGSERIAL PRIMARY KEY,
  organizer_id BIGINT NOT NULL REFERENCES users(id),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  venue        TEXT NOT NULL,
  city         TEXT NOT NULL,
  starts_at    TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The home page lists upcoming events, so we look events up by start time.
CREATE INDEX events_starts_at_idx ON events (starts_at);
CREATE INDEX events_organizer_idx ON events (organizer_id);

-- A booking is one checkout: it starts as a 10 minute hold, then becomes
-- confirmed (paid) or expired (the user didn't pay in time).
CREATE TABLE bookings (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id),
  event_id        BIGINT NOT NULL REFERENCES events(id),
  status          TEXT NOT NULL CHECK (status IN ('held', 'confirmed', 'expired', 'cancelled')),
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
  hold_expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "My tickets" page: all bookings of one user, newest first.
CREATE INDEX bookings_user_idx ON bookings (user_id, created_at DESC);
-- The hold expiry job only looks at active holds, so a partial index keeps it small.
CREATE INDEX bookings_active_holds_idx ON bookings (hold_expires_at) WHERE status = 'held';

-- Every seat of an event is its own row, so two people can't hold the same seat.
CREATE TABLE seats (
  id          BIGSERIAL PRIMARY KEY,
  event_id    BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  row_label   TEXT NOT NULL,
  seat_number INTEGER NOT NULL CHECK (seat_number > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held', 'sold')),
  booking_id  BIGINT REFERENCES bookings(id),
  UNIQUE (event_id, row_label, seat_number),
  -- A seat that is held or sold must point to the booking that owns it.
  CHECK ((status = 'available') = (booking_id IS NULL))
);

-- The seat map query: all seats of one event.
CREATE INDEX seats_event_idx ON seats (event_id);
CREATE INDEX seats_booking_idx ON seats (booking_id);

-- Which seats were part of a booking. Kept even after a hold expires,
-- so the booking history stays correct.
CREATE TABLE booking_seats (
  booking_id  BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  seat_id     BIGINT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL,
  PRIMARY KEY (booking_id, seat_id)
);
