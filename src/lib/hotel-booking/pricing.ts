import type {
  HotelBookingSettings,
  NightRate,
  PriceQuote,
  RateCalendarRow,
  RoomTypeRecord,
  SeasonalRateRow,
  TaxRow,
} from './types'
import {
  eachStayDate,
  formatIsoDate,
  isWeekend,
  nightsBetween,
  parseIsoDate,
  roundMoney,
  roundRupee,
} from './money'

export interface PricingInput {
  hotelId: string
  hotelName: string
  room: RoomTypeRecord
  checkIn: string
  checkOut: string
  rooms: number
  adults: number
  children: number
  calendar: RateCalendarRow[]
  seasons: SeasonalRateRow[]
  taxes: TaxRow[]
  settings: Pick<HotelBookingSettings, 'advance_percent' | 'currency' | 'default_tax_percent' | 'tax_label'>
  cancellationPolicy: string
  inventoryByDate: Record<string, number>
}

export function validateStayDates(checkIn: string, checkOut: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
    return 'Please share dates as DD/MM/YYYY (for example 10/11/2026).'
  }
  const nights = nightsBetween(checkIn, checkOut)
  if (Number.isNaN(nights) || nights < 1) {
    return 'Check-out must be after check-in.'
  }
  const today = formatIsoDate(new Date())
  if (checkIn < today) {
    return 'Check-in cannot be in the past.'
  }
  return null
}

function calendarMap(rows: RateCalendarRow[]): Map<string, RateCalendarRow> {
  const m = new Map<string, RateCalendarRow>()
  for (const row of rows) m.set(row.stay_date.slice(0, 10), row)
  return m
}

function seasonFor(date: string, seasons: SeasonalRateRow[], roomTypeId: string): SeasonalRateRow | null {
  const matches = seasons.filter((s) => {
    if (date < s.start_date || date > s.end_date) return false
    return !s.room_type_id || s.room_type_id === roomTypeId
  })
  return matches[0] ?? null
}

export function rateForNight(
  date: string,
  room: RoomTypeRecord,
  calendar: Map<string, RateCalendarRow>,
  seasons: SeasonalRateRow[],
): NightRate {
  const cal = calendar.get(date)
  if (cal?.rate != null) {
    return { date, rate_per_room: roundMoney(Number(cal.rate)), source: 'calendar' }
  }
  const season = seasonFor(date, seasons, room.id)
  if (season?.rate != null) {
    return { date, rate_per_room: roundMoney(Number(season.rate)), source: 'season' }
  }
  const weekend = isWeekend(date)
  const weekendRate = room.base_weekend_rate
  let base =
    weekend && weekendRate != null && Number(weekendRate) > 0
      ? Number(weekendRate)
      : Number(room.base_weekday_rate)
  if (season?.multiplier && Number(season.multiplier) !== 1) {
    base = base * Number(season.multiplier)
    return { date, rate_per_room: roundMoney(base), source: 'season' }
  }
  return {
    date,
    rate_per_room: roundMoney(base),
    source: weekend ? 'weekend' : 'weekday',
  }
}

export function calculateQuote(input: PricingInput): PriceQuote {
  const nights = nightsBetween(input.checkIn, input.checkOut)
  const dates = eachStayDate(input.checkIn, input.checkOut)
  const cal = calendarMap(input.calendar)
  const nightRates = dates.map((d) => rateForNight(d, input.room, cal, input.seasons))

  const unavailable: string[] = []
  for (const d of dates) {
    const row = cal.get(d)
    if (row?.is_closed) {
      unavailable.push(d)
      continue
    }
    const available = input.inventoryByDate[d] ?? input.room.total_rooms
    if (available < input.rooms) unavailable.push(d)
    const minStay = row?.min_stay_nights ?? 1
    if (minStay > nights) unavailable.push(d)
  }

  const roomSubtotal = roundMoney(
    nightRates.reduce((sum, n) => sum + n.rate_per_room * input.rooms, 0),
  )

  const extraAdults = Math.max(0, input.adults - input.room.included_adults * input.rooms)
  const extraChildren = Math.max(0, input.children - input.room.included_children * input.rooms)
  const extraCharges = roundMoney(
    extraAdults * Number(input.room.extra_adult_charge) * nights +
      extraChildren * Number(input.room.extra_child_charge) * nights,
  )
  const extraNoteParts: string[] = []
  if (extraAdults > 0 && Number(input.room.extra_adult_charge) > 0) {
    extraNoteParts.push(
      `${extraAdults} extra adult(s) × ${nights} night(s) × ${input.room.extra_adult_charge}`,
    )
  }
  if (extraChildren > 0 && Number(input.room.extra_child_charge) > 0) {
    extraNoteParts.push(
      `${extraChildren} extra child(ren) × ${nights} night(s) × ${input.room.extra_child_charge}`,
    )
  }

  const taxable = roomSubtotal + extraCharges
  let taxAmount = 0
  const taxNotes: string[] = []
  const activeTaxes = input.taxes.filter((t) => t.is_active)
  if (activeTaxes.length > 0) {
    for (const tax of activeTaxes) {
      const part = taxable * (Number(tax.percent) / 100) + Number(tax.fixed_amount)
      taxAmount += part
      taxNotes.push(`${tax.name}: ${tax.percent}% + ${tax.fixed_amount}`)
    }
  } else if (Number(input.settings.default_tax_percent) > 0) {
    taxAmount = taxable * (Number(input.settings.default_tax_percent) / 100)
    taxNotes.push(`${input.settings.tax_label}: ${input.settings.default_tax_percent}%`)
  }
  taxAmount = roundMoney(taxAmount)

  const total = roundMoney(taxable + taxAmount)
  const advancePercent = Number(input.settings.advance_percent) || 20
  const advance = roundRupee(total * (advancePercent / 100))
  const balance = roundMoney(total - advance)

  return {
    hotel_id: input.hotelId,
    hotel_name: input.hotelName,
    room_type_id: input.room.id,
    room_type_name: input.room.name,
    check_in: input.checkIn,
    check_out: input.checkOut,
    nights,
    rooms: input.rooms,
    adults: input.adults,
    children: input.children,
    night_rates: nightRates,
    room_subtotal: roomSubtotal,
    extra_charges: extraCharges,
    extra_charges_note: extraNoteParts.join('; ') || undefined,
    tax_amount: taxAmount,
    tax_note: taxNotes.join('; ') || undefined,
    discount_amount: 0,
    total_amount: total,
    currency: input.settings.currency,
    advance_percent: advancePercent,
    advance_amount: advance,
    balance_amount: balance,
    cancellation_policy: input.cancellationPolicy,
    availability_ok: unavailable.length === 0,
    unavailable_dates: unavailable.length ? [...new Set(unavailable)] : undefined,
    estimated: false,
  }
}

export function occupancyFits(
  room: RoomTypeRecord,
  adults: number,
  children: number,
  rooms: number,
): boolean {
  if (adults > room.max_adults * rooms) return false
  if (children > room.max_children * rooms) return false
  if (adults + children > room.max_occupancy * rooms) return false
  return true
}

export function quoteFitsBudget(
  quote: PriceQuote,
  budgetAmount: number | undefined,
  budgetType: 'total' | 'per_room_night' | 'range' | undefined,
  budgetMax?: number,
): { ok: boolean; overBy: number } {
  if (budgetAmount == null && budgetMax == null) return { ok: true, overBy: 0 }
  if (budgetType === 'per_room_night') {
    const avg =
      quote.nights > 0 ? quote.room_subtotal / quote.nights / quote.rooms : quote.total_amount
    const cap = budgetMax ?? budgetAmount ?? Infinity
    return { ok: avg <= cap + 0.01, overBy: Math.max(0, roundMoney(avg - cap)) }
  }
  const cap = budgetMax ?? budgetAmount ?? Infinity
  return { ok: quote.total_amount <= cap + 0.01, overBy: Math.max(0, roundMoney(quote.total_amount - cap)) }
}

export { parseIsoDate }
