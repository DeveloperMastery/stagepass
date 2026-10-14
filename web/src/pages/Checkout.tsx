import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type Booking } from '../api'
import { formatDateTime, formatPrice, seatLabel } from '../format'

function useSecondsLeft(until: string | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  if (!until) return 0
  return Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000))
}

export default function Checkout() {
  const bookingId = Number(useParams().bookingId)
  const navigate = useNavigate()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState(false)
  const secondsLeft = useSecondsLeft(booking?.holdExpiresAt)

  useEffect(() => {
    api
      .booking(bookingId)
      .then((res) => {
        if (res.booking.status === 'confirmed') navigate('/tickets', { replace: true })
        else setBooking(res.booking)
      })
      .catch((err) => setError(err.message))
  }, [bookingId, navigate])

  if (!booking) return error ? <p className="error">{error}</p> : <p className="muted">Loading...</p>

  const expired = booking.status !== 'held' || secondsLeft === 0

  async function pay() {
    setPaying(true)
    setError('')
    try {
      await api.confirm(bookingId)
      navigate('/tickets', { state: { justBooked: bookingId } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed. Try again.')
      setPaying(false)
    }
  }

  async function cancel() {
    await api.cancel(bookingId)
    navigate(`/events/${booking!.event.id}`)
  }

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(secondsLeft % 60).padStart(2, '0')

  return (
    <div className="checkout">
      <h1 className="page-title">Checkout</h1>

      <div className={`hold-timer${expired ? ' hold-timer--expired' : secondsLeft < 60 ? ' hold-timer--urgent' : ''}`} role="timer">
        {expired ? (
          <>
            Your hold has expired and the seats are back on sale.{' '}
            <Link to={`/events/${booking.event.id}`}>Pick seats again</Link>
          </>
        ) : (
          <>
            Seats held for <strong>{minutes}:{seconds}</strong>
          </>
        )}
      </div>

      <section className="checkout__card">
        <h2 className="checkout__event">{booking.event.title}</h2>
        <p className="muted">
          {formatDateTime(booking.event.startsAt)}. {booking.event.venue}, {booking.event.city}
        </p>
        <ul className="summary__seats">
          {booking.seats.map((s) => (
            <li key={s.id}>
              <span>Seat {seatLabel(s)}</span>
              <span>{formatPrice(s.priceCents)}</span>
            </li>
          ))}
        </ul>
        <div className="summary__total">
          <span>Total</span>
          <strong>{formatPrice(booking.totalCents)}</strong>
        </div>

        <p className="muted small">This is a demo. No real payment is taken.</p>
        {error && <p className="error">{error}</p>}
        <div className="checkout__actions">
          <button className="button button--primary" disabled={expired || paying} onClick={pay}>
            {paying ? 'Paying...' : `Pay ${formatPrice(booking.totalCents)}`}
          </button>
          {!expired && (
            <button className="button" onClick={cancel} disabled={paying}>
              Release seats
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
