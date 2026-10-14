function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const bookingMode = process.env.BOOKING_MODE ?? 'safe';
if (bookingMode !== 'safe' && bookingMode !== 'unsafe') {
  throw new Error('BOOKING_MODE must be "safe" or "unsafe"');
}

export const config = {
  // 127.0.0.1 means only processes on this machine (Nginx) can reach the API.
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  holdMinutes: Number(process.env.HOLD_MINUTES ?? 10),
  // "unsafe" turns off row locking when reserving seats. Only for the race condition demo.
  bookingMode: bookingMode as 'safe' | 'unsafe',
  // Set to true once the site is served over HTTPS.
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  maxSeatsPerBooking: 6,
};
