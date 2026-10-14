import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type OrganizerEvent } from '../api'
import { formatDateTime, formatPrice } from '../format'

export default function OrganizerPage() {
  const [events, setEvents] = useState<OrganizerEvent[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .organizerEvents()
      .then((res) => setEvents(res.events))
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!events) return <p className="muted">Loading...</p>

  const revenue = events.reduce((sum, e) => sum + e.revenueCents, 0)
  const sold = events.reduce((sum, e) => sum + e.soldSeats, 0)

  return (
    <>
      <div className="page-heading">
        <h1 className="page-title">Your events</h1>
        <Link to="/organizer/new" className="button button--primary">
          Create event
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="empty">
          You haven't created any events yet. <Link to="/organizer/new">Create your first event</Link>
        </p>
      ) : (
        <>
          <p className="muted">
            {sold} tickets sold across {events.length} events, {formatPrice(revenue)} in revenue.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date</th>
                  <th className="num">Sold</th>
                  <th className="num">On hold</th>
                  <th className="num">Revenue</th>
                  <th>Sales</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const pct = e.totalSeats ? Math.round((e.soldSeats / e.totalSeats) * 100) : 0
                  return (
                    <tr key={e.id}>
                      <td>
                        <Link to={`/events/${e.id}`}>{e.title}</Link>
                        <div className="muted small">
                          {e.venue}, {e.city}
                        </div>
                      </td>
                      <td>{formatDateTime(e.startsAt)}</td>
                      <td className="num">
                        {e.soldSeats} / {e.totalSeats}
                      </td>
                      <td className="num">{e.heldSeats}</td>
                      <td className="num">{formatPrice(e.revenueCents)}</td>
                      <td>
                        <div className="meter" role="img" aria-label={`${pct}% sold`}>
                          <div className="meter__fill" style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
