import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, type Booking } from '../api'
import { formatDate, formatPrice, formatTime, seatLabel } from '../format'

export default function MyTickets() {
  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [error, setError] = useState('')
  const justBooked = (useLocation().state as { justBooked?: number } | null)?.justBooked

  useEffect(() => {
    api
      .bookings()
      .then((res) => setBookings(res.bookings))
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!bookings) return <p className="muted">Loading...</p>

  const now = Date.now()
  const active = bookings.filter((b) => b.status === 'confirmed' || new Date(b.holdExpiresAt).getTime() > now)

  return (
    <>
      <h1 className="page-title">My tickets</h1>
      {justBooked && <p className="notice">You're going. Your tickets are below.</p>}
      {active.length === 0 && (
        <p className="empty">
          You don't have any tickets yet. <Link to="/">Find an event</Link>
        </p>
      )}
      <ul className="tickets">
        {active.map((b) => (
          <li key={b.id} className={`ticket${b.status === 'held' ? ' ticket--held' : ''}`}>
            <div className="ticket__body">
              <h2 className="ticket__title">{b.event.title}</h2>
              <p className="muted">
                {b.event.venue}, {b.event.city}
              </p>
              <dl className="ticket__facts">
                <div>
                  <dt>Date</dt>
                  <dd>{formatDate(b.event.startsAt)}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{formatTime(b.event.startsAt)}</dd>
                </div>
                <div>
                  <dt>Seats</dt>
                  <dd>{b.seats.map(seatLabel).join(', ')}</dd>
                </div>
              </dl>
            </div>
            <div className="ticket__stub">
              {b.status === 'confirmed' ? (
                <>
                  <span className="ticket__code">#{String(b.id).padStart(6, '0')}</span>
                  <span>{formatPrice(b.totalCents)} paid</span>
                </>
              ) : (
                <>
                  <span>Not paid yet</span>
                  <Link to={`/checkout/${b.id}`} className="button button--primary">
                    Finish checkout
                  </Link>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
