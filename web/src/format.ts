const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatPrice(cents: number) {
  return money.format(cents / 100)
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function formatDateTime(iso: string) {
  return `${formatDate(iso)}, ${formatTime(iso)}`
}

export function seatLabel(seat: { row: string; number: number }) {
  return `${seat.row}${seat.number}`
}
