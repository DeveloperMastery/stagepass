import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

type Section = { name: string; rows: number; seatsPerRow: number; price: number }

export default function NewEvent() {
  const navigate = useNavigate()
  const [details, setDetails] = useState({ title: '', description: '', venue: '', city: '', startsAt: '' })
  const [sections, setSections] = useState<Section[]>([
    { name: 'Front', rows: 2, seatsPerRow: 10, price: 60 },
    { name: 'Back', rows: 4, seatsPerRow: 12, price: 40 },
  ])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const totalRows = sections.reduce((sum, s) => sum + s.rows, 0)
  const totalSeats = sections.reduce((sum, s) => sum + s.rows * s.seatsPerRow, 0)

  function updateSection(i: number, patch: Partial<Section>) {
    setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (totalRows > 26) {
      setError('A venue can have at most 26 rows (A to Z).')
      return
    }
    setSubmitting(true)
    setError('')
    // Turn sections into one entry per row, front row first
    const rows = sections.flatMap((s) =>
      Array.from({ length: s.rows }, () => ({ seats: s.seatsPerRow, priceCents: Math.round(s.price * 100) })),
    )
    try {
      const res = await api.createEvent({ ...details, startsAt: new Date(details.startsAt).toISOString(), rows })
      navigate(`/events/${res.event.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the event')
      setSubmitting(false)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h1 className="page-title">Create event</h1>
      <label>
        Title
        <input required minLength={3} value={details.title} onChange={(e) => setDetails({ ...details, title: e.target.value })} />
      </label>
      <label>
        Description
        <textarea rows={3} value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} />
      </label>
      <div className="form-grid">
        <label>
          Venue
          <input required value={details.venue} onChange={(e) => setDetails({ ...details, venue: e.target.value })} />
        </label>
        <label>
          City
          <input required value={details.city} onChange={(e) => setDetails({ ...details, city: e.target.value })} />
        </label>
        <label>
          Starts at
          <input
            type="datetime-local"
            required
            value={details.startsAt}
            onChange={(e) => setDetails({ ...details, startsAt: e.target.value })}
          />
        </label>
      </div>

      <fieldset className="sections">
        <legend>Seating, front of the venue first</legend>
        {sections.map((s, i) => (
          <div className="section-row" key={i}>
            <label>
              Section
              <input value={s.name} onChange={(e) => updateSection(i, { name: e.target.value })} />
            </label>
            <label>
              Rows
              <input type="number" min={1} max={26} required value={s.rows} onChange={(e) => updateSection(i, { rows: Number(e.target.value) })} />
            </label>
            <label>
              Seats per row
              <input
                type="number"
                min={1}
                max={40}
                required
                value={s.seatsPerRow}
                onChange={(e) => updateSection(i, { seatsPerRow: Number(e.target.value) })}
              />
            </label>
            <label>
              Price ($)
              <input type="number" min={0} step="0.01" required value={s.price} onChange={(e) => updateSection(i, { price: Number(e.target.value) })} />
            </label>
            {sections.length > 1 && (
              <button type="button" className="link-button" onClick={() => setSections(sections.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="button"
          onClick={() => setSections([...sections, { name: 'New section', rows: 2, seatsPerRow: 10, price: 30 }])}
        >
          Add section
        </button>
        <p className="muted small">
          {totalRows} rows, {totalSeats} seats in total
        </p>
      </fieldset>

      {error && <p className="error">{error}</p>}
      <button className="button button--primary" disabled={submitting}>
        {submitting ? 'Creating...' : 'Create event'}
      </button>
    </form>
  )
}
