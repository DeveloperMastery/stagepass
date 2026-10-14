import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type EventSummary } from '../api'
import { formatPrice, formatTime } from '../format'

export default function EventsPage() {
  const [events, setEvents] = useState<EventSummary[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .events()
      .then((res) => setEvents(res.events))
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!events) return <p className="muted">Loading events...</p>

  return (
    <>
      <h1 className="page-title">Upcoming events</h1>
      {events.length === 0 && <p className="empty">No upcoming events yet.</p>}
      <ol className="event-list">
        {events.map((e) => {
          const date = new Date(e.startsAt)
          const soldOut = e.availableSeats === 0
          return (
            <li key={e.id}>
              <Link to={`/events/${e.id}`} className="event-row">
                <time className="date-block" dateTime={e.startsAt}>
                  <span className="date-block__month">{date.toLocaleDateString('en-US', { month: 'short' })}</span>
                  <span className="date-block__day">{date.getDate()}</span>
                  <span className="date-block__weekday">{date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                </time>
                <div className="event-row__main">
                  <h2 className="event-row__title">{e.title}</h2>
                  <p className="event-row__meta">
                    {e.venue}, {e.city} at {formatTime(e.startsAt)}
                  </p>
                </div>
                <div className="event-row__price">
                  {soldOut ? (
                    <span className="sold-out">Sold out</span>
                  ) : (
                    <>
                      <span className="event-row__from">from {formatPrice(e.minPriceCents ?? 0)}</span>
                      <span className="muted small">
                        {e.availableSeats} of {e.totalSeats} seats left
                      </span>
                    </>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ol>
    </>
  )
}
