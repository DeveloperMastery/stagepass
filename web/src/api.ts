export type Role = 'customer' | 'organizer'
export type User = { id: number; name: string; email: string; role: Role }

export type EventSummary = {
  id: number
  title: string
  description: string
  venue: string
  city: string
  startsAt: string
  minPriceCents: number | null
  totalSeats: number
  availableSeats: number
}

export type Seat = {
  id: number
  row: string
  number: number
  priceCents: number
  status: 'available' | 'held' | 'sold'
}

export type EventDetail = {
  event: Omit<EventSummary, 'minPriceCents' | 'totalSeats' | 'availableSeats'> & { organizerName: string }
  seats: Seat[]
}

export type Booking = {
  id: number
  status: 'held' | 'confirmed' | 'expired' | 'cancelled'
  totalCents: number
  holdExpiresAt: string
  confirmedAt: string | null
  createdAt: string
  event: { id: number; title: string; venue: string; city: string; startsAt: string }
  seats: { id: number; row: string; number: number; priceCents: number }[]
}

export type OrganizerEvent = {
  id: number
  title: string
  venue: string
  city: string
  startsAt: string
  totalSeats: number
  soldSeats: number
  heldSeats: number
  revenueCents: number
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// All requests go to /api on the same domain. Nginx forwards them to the Node API,
// so the browser sends the session cookie automatically.
async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (res.status === 204) return undefined as T

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const details = data?.details ? ` (${data.details.join(', ')})` : ''
    throw new ApiError(res.status, (data?.error ?? `Request failed with status ${res.status}`) + details)
  }
  return data as T
}

export const api = {
  health: () => request<{ status: string; server: string }>('/health'),
  me: () => request<{ user: User }>('/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } }),
  register: (body: { name: string; email: string; password: string; role: Role }) =>
    request<{ user: User }>('/auth/register', { method: 'POST', body }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  events: () => request<{ events: EventSummary[] }>('/events'),
  event: (id: number) => request<EventDetail>(`/events/${id}`),

  reserve: (eventId: number, seatIds: number[]) =>
    request<{ booking: { id: number } }>('/bookings', { method: 'POST', body: { eventId, seatIds } }),
  booking: (id: number) => request<{ booking: Booking }>(`/bookings/${id}`),
  bookings: () => request<{ bookings: Booking[] }>('/bookings'),
  confirm: (id: number) => request<{ booking: Booking }>(`/bookings/${id}/confirm`, { method: 'POST' }),
  cancel: (id: number) => request<void>(`/bookings/${id}/cancel`, { method: 'POST' }),

  organizerEvents: () => request<{ events: OrganizerEvent[] }>('/organizer/events'),
  createEvent: (body: {
    title: string
    description: string
    venue: string
    city: string
    startsAt: string
    rows: { seats: number; priceCents: number }[]
  }) => request<{ event: { id: number } }>('/organizer/events', { method: 'POST', body }),
}
