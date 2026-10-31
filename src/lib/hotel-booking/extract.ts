import type { BudgetType, CollectedDetails } from './types'
import { addDaysIso, formatIsoDate } from './money'

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const iso = `${y}-${pad(m)}-${pad(d)}`
  const check = new Date(Date.UTC(y, m - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null
  }
  return iso
}

function yearGuess(month: number, day: number): number {
  const now = new Date()
  const y = now.getFullYear()
  const candidate = toIso(y, month, day)
  const today = formatIsoDate(now)
  if (candidate && candidate >= today) return y
  return y + 1
}

export function parseDatesFromText(text: string): { check_in?: string; check_out?: string } {
  const lower = text.toLowerCase()
  const found: string[] = []

  const iso = lower.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)
  for (const m of iso) {
    const v = toIso(Number(m[1]), Number(m[2]), Number(m[3]))
    if (v) found.push(v)
  }

  const dmy = lower.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g)
  for (const m of dmy) {
    let y = Number(m[3])
    if (y < 100) y += 2000
    const d = Number(m[1])
    const mo = Number(m[2])
    const v = d > 12 ? toIso(y, mo, d) : toIso(y, mo, d)
    if (v) found.push(v)
  }

  const named = lower.matchAll(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/g,
  )
  for (const m of named) {
    const mo = MONTHS[m[2]]
    const d = Number(m[1])
    const y = m[3] ? Number(m[3]) : yearGuess(mo, d)
    const v = toIso(y, mo, d)
    if (v) found.push(v)
  }

  if (/\btomorrow\b/.test(lower) || /\bnaalai\b/.test(lower) || /\bnaalai\b/.test(lower)) {
    found.push(addDaysIso(formatIsoDate(new Date()), 1))
  }
  if (/\btoday\b/.test(lower) || /\binnaiku\b/.test(lower)) {
    found.push(formatIsoDate(new Date()))
  }

  const unique = [...new Set(found)].sort()
  if (unique.length >= 2) return { check_in: unique[0], check_out: unique[1] }
  if (unique.length === 1) {
    if (/\bcheck[- ]?out\b/.test(lower)) return { check_out: unique[0] }
    return { check_in: unique[0] }
  }
  return {}
}

function numberAfter(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*(?:is|:)?\\s*(\\d{1,2})`, 'i')
    const m = text.match(re)
    if (m) return Number(m[1])
  }
  return undefined
}

export function extractDetails(text: string, existing: CollectedDetails): Partial<CollectedDetails> {
  const out: Partial<CollectedDetails> = {}
  const dates = parseDatesFromText(text)
  if (dates.check_in && !existing.check_in) out.check_in = dates.check_in
  if (dates.check_out && !existing.check_out) out.check_out = dates.check_out
  if (dates.check_in && existing.check_in && dates.check_in !== existing.check_in) {
    out.check_in = dates.check_in
  }
  if (dates.check_out && existing.check_out && dates.check_out !== existing.check_out) {
    out.check_out = dates.check_out
  }

  const adults = numberAfter(text, [
    'adults?',
    'pax',
    'persons?',
    'people',
    'per',
    'பெரியவர்கள்',
  ])
  if (adults != null) out.adults = adults

  const children = numberAfter(text, ['children', 'child', 'kids?', 'pasanga', 'குழந்தை'])
  if (children != null) out.children = children

  const rooms = numberAfter(text, ['rooms?', 'room', 'அறை'])
  if (rooms != null) out.rooms = rooms

  const ages = text.match(/ages?\s*[:\-]?\s*([\d,\s]+)/i)
  if (ages) {
    out.child_ages = ages[1]
      .split(/[,\s]+/)
      .map(Number)
      .filter((n) => n > 0 && n < 18)
  }

  const dest = text.match(
    /(?:in|at|to|for|location|place|ooru|ஊர்)\s+([A-Za-z\u0B80-\u0BFF ]{3,40})/i,
  )
  if (dest) {
    const place = dest[1].replace(/\b(from|on|for|hotel|please).*/i, '').trim()
    if (place.length >= 3) out.destination = place
  }

  const name = text.match(/(?:my name is|i am|this is|naam|peyar)\s+([A-Za-z. ]{2,40})/i)
  if (name) out.customer_name = name[1].trim()

  const special = text.match(/(?:special|requirement|need|venum)\s*[:\-]?\s*(.+)$/i)
  if (special && special[1].length > 4) out.special_requirements = special[1].trim()

  const roomType = text.match(
    /\b(deluxe|standard|suite|ac|non[- ]?ac|sea view|family|twin|double|single)\b/i,
  )
  if (roomType) out.preferred_room_type = roomType[1]

  return out
}

export function extractBudget(text: string): Partial<CollectedDetails> {
  const lower = text.toLowerCase()
  const flexible = /flexib|okay if|alright if|nearby|around|approx|flexible|parava illa/.test(lower)
  const perNight = /per\s*(room\s*)?(night|day)|room\s*per\s*night|one night|oriru/.test(lower)

  const range = lower.match(/(\d[\d,]*)\s*(?:to|-|and)\s*(\d[\d,]*)/)
  const single = lower.match(/(?:rs\.?|inr|₹)?\s*(\d[\d,]*)/)

  if (range) {
    const min = Number(range[1].replace(/,/g, ''))
    const max = Number(range[2].replace(/,/g, ''))
    if (min > 0 && max >= min) {
      return {
        budget_type: 'range',
        budget_min: min,
        budget_max: max,
        budget_amount: max,
        budget_flexible: flexible,
      }
    }
  }

  if (single) {
    const amount = Number(single[1].replace(/,/g, ''))
    if (amount > 0) {
      const budget_type: BudgetType = perNight ? 'per_room_night' : 'total'
      return { budget_amount: amount, budget_type, budget_flexible: flexible }
    }
  }
  return {}
}

export function missingRequired(c: CollectedDetails): string[] {
  const missing: string[] = []
  if (!c.customer_name) missing.push('customer_name')
  if (!c.destination) missing.push('destination')
  if (!c.check_in) missing.push('check_in')
  if (!c.check_out) missing.push('check_out')
  if (!c.adults) missing.push('adults')
  if (!c.rooms) missing.push('rooms')
  return missing
}

export function mergeCollected(
  current: CollectedDetails,
  patch: Partial<CollectedDetails>,
): CollectedDetails {
  return { ...current, ...patch }
}
