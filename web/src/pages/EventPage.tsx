import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, type EventDetail, type Seat } from '../api'
import { useAuth } from '../auth'
import { formatDateTime, formatPrice, seatLabel } from '../format'

const MAX_SEATS = 6

export default function EventPage() {
  const id = Number(useParams().id)
  const { user } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState<EventDetail | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState('')
  const [reserving, setReserving] = useState(false)

  const load = useCallback(() => {
    return api
      .event(id)
      .then((res) => {
        setData(res)
        // Drop any selected seat that someone else took in the meantime
        const free = new Set(res.seats.filter((s) => s.status === 'available').map((s) => s.id))
        setSelected((prev) => prev.filter((seatId) => free.has(seatId)))
      })
      .catch((err) => setError(err.message))
  }, [id])

  useEffect(() => {
    load()
    // Refresh the seat map every 10 seconds so you see other people's holds
    const timer = setInterval(load, 10_000)
    return () => clearInterval(timer)
  }, [load])

  const rows = useMemo(() => {
    const byRow = new Map<string, Seat[]>()
    for (const seat of data?.seats ?? []) {
      byRow.set(seat.row, [...(byRow.get(seat.row) ?? []), seat])
    }
    return [...byRow.entries()]
  }, [data])

  const priceTiers = useMemo(
    () => [...new Set((data?.seats ?? []).map((s) => s.priceCents))].sort((a, b) => b - a),
    [data],
  )

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">Loading...</p>

  const { event, seats } = data
  const selectedSeats = seats.filter((s) => selected.includes(s.id))
  const total = selectedSeats.reduce((sum, s) => sum + s.priceCents, 0)
  const isPast = new Date(event.startsAt) < new Date()

  function toggle(seat: Seat) {
    if (seat.status !== 'available') return
    setError('')
    setSelected((prev) => {
      if (prev.includes(seat.id)) return prev.filter((x) => x !== seat.id)
      if (prev.length >= MAX_SEATS) {
        setError(`You can pick up to ${MAX_SEATS} seats at once.`)
        return prev
      }
      return [...prev, seat.id]
    })
  }

  async function reserve() {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/events/${id}`)}`)
      return
    }
    setReserving(true)
    setError('')
    try {
      const res = await api.reserve(id, selected)
      navigate(`/checkout/${res.booking.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reserve the seats. Try again.')
      if (err instanceof ApiError && err.status === 409) await load()
    } finally {
      setReserving(false)
    }
  }

  return (
    <div className="event-page">
      <section className="event-header">
        <h1 className="event-title">{event.title}</h1>
        <p className="event-meta">
          {formatDateTime(event.startsAt)}. {event.venue}, {event.city}
        </p>
        {event.description && <p className="event-description">{event.description}</p>}
        <p className="muted small">Organized by {event.organizerName}</p>
      </section>

      <div className="booking-layout">
        <section className="seat-map" aria-label="Seat map">
          <div className="stage">Stage</div>
          <div className="seat-rows">
            {rows.map(([row, rowSeats]) => (
              <div className="seat-row" key={row}>
                <span className="row-label">{row}</span>
                <div className="seat-row__seats">
                  {rowSeats.map((seat) => {
                    const isSelected = selected.includes(seat.id)
                    const tier = priceTiers.indexOf(seat.priceCents)
                    return (
                      <button
                        key={seat.id}
                        className={`seat seat--${seat.status} seat--tier-${Math.min(tier, 2)}${isSelected ? ' seat--selected' : ''}`}
                        disabled={seat.status !== 'available' || isPast}
                        aria-pressed={isSelected}
                        aria-label={`Seat ${seatLabel(seat)}, ${formatPrice(seat.priceCents)}, ${isSelected ? 'selected' : seat.status}`}
                        title={`${seatLabel(seat)}: ${formatPrice(seat.priceCents)}`}
                        onClick={() => toggle(seat)}
                      >
                        {seat.number}
                      </button>
                    )
                  })}
                </div>
                <span className="row-label">{row}</span>
              </div>
            ))}
          </div>
          <ul className="legend">
            {priceTiers.slice(0, 3).map((price, i) => (
              <li key={price}>
                <span className={`seat seat--available seat--tier-${i} legend__swatch`} /> {formatPrice(price)}
              </li>
            ))}
            <li>
              <span className="seat seat--selected legend__swatch" /> Your pick
            </li>
            <li>
              <span className="seat seat--held legend__swatch" /> On hold
            </li>
            <li>
              <span className="seat seat--sold legend__swatch" /> Sold
            </li>
          </ul>
        </section>

        <aside className="summary">
          <h2 className="summary__title">Your seats</h2>
          {selectedSeats.length === 0 ? (
            <p className="muted">{isPast ? 'This event has already started.' : 'Pick seats on the map. You can choose up to 6.'}</p>
          ) : (
            <ul className="summary__seats">
              {selectedSeats.map((s) => (
                <li key={s.id}>
                  <span>Seat {seatLabel(s)}</span>
                  <span>{formatPrice(s.priceCents)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="summary__total">
            <span>Total</span>
            <strong>{formatPrice(total)}</strong>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="button button--primary button--block" disabled={selected.length === 0 || reserving} onClick={reserve}>
            {reserving ? 'Reserving...' : user ? 'Reserve seats' : 'Log in to reserve'}
          </button>
          <p className="muted small">We hold your seats for 10 minutes while you check out.</p>
        </aside>
      </div>
    </div>
  )
}
