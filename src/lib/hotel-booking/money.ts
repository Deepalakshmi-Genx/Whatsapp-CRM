export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function roundRupee(value: number): number {
  return Math.round(value)
}

export function formatMoney(value: number, currency = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `
  const n = roundMoney(value)
  return `${symbol}${n.toLocaleString('en-IN', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parseIsoDate(checkIn)
  const b = parseIsoDate(checkOut)
  const ms = b.getTime() - a.getTime()
  return Math.round(ms / 86_400_000)
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function formatIsoDate(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function eachStayDate(checkIn: string, checkOut: string): string[] {
  const nights = nightsBetween(checkIn, checkOut)
  const dates: string[] = []
  const start = parseIsoDate(checkIn)
  for (let i = 0; i < nights; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    dates.push(formatIsoDate(d))
  }
  return dates
}

export function isWeekend(isoDate: string): boolean {
  const day = parseIsoDate(isoDate).getUTCDay()
  return day === 0 || day === 6
}

export function addHours(iso: string | Date, hours: number): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return new Date(d.getTime() + hours * 3_600_000).toISOString()
}

export function addDaysIso(isoDate: string, days: number): string {
  const d = parseIsoDate(isoDate)
  d.setUTCDate(d.getUTCDate() + days)
  return formatIsoDate(d)
}

export function formatDisplayDate(isoDate: string): string {
  const d = parseIsoDate(isoDate)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
