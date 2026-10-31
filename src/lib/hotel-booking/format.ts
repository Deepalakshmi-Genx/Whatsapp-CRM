import type { CollectedDetails, HotelRecord, PriceQuote, RoomTypeRecord } from './types'
import { formatDisplayDate, formatMoney } from './money'

export function formatDetailsSummary(c: CollectedDetails, phone: string): string {
  const kids =
    c.children && c.children > 0
      ? `${c.children}${c.child_ages?.length ? ` (ages ${c.child_ages.join(', ')})` : ''}`
      : '0'
  return [
    'Please confirm these details:',
    '',
    `Name: ${c.customer_name ?? '—'}`,
    `Phone: ${c.contact_number ?? phone}`,
    `Location: ${c.destination ?? '—'}`,
    `Check-in: ${c.check_in ? formatDisplayDate(c.check_in) : '—'}`,
    `Check-out: ${c.check_out ? formatDisplayDate(c.check_out) : '—'}`,
    `Adults: ${c.adults ?? '—'}`,
    `Children: ${kids}`,
    `Rooms: ${c.rooms ?? '—'}`,
    c.preferred_room_type ? `Room type: ${c.preferred_room_type}` : null,
    c.special_requirements ? `Special requests: ${c.special_requirements}` : null,
    '',
    'Reply YES to continue, or tell me what to change.',
  ]
    .filter((line) => line !== null)
    .join('\n')
}

export function formatNightBreakdown(quote: PriceQuote): string {
  const rates = quote.night_rates.map((n) => n.rate_per_room)
  const allSame = rates.every((r) => r === rates[0])
  if (allSame) {
    return `${formatMoney(rates[0], quote.currency)} per room × ${quote.rooms} room(s) × ${quote.nights} night(s)`
  }
  return quote.night_rates
    .map(
      (n, i) =>
        `Night ${i + 1} (${formatDisplayDate(n.date)}): ${formatMoney(n.rate_per_room, quote.currency)} per room`,
    )
    .join('\n')
}

export function formatQuote(quote: PriceQuote): string {
  const lines = [
    `🏨 ${quote.hotel_name}`,
    `Room: ${quote.room_type_name}`,
    `Stay: ${formatDisplayDate(quote.check_in)} → ${formatDisplayDate(quote.check_out)} (${quote.nights} night${quote.nights === 1 ? '' : 's'})`,
    `Rooms: ${quote.rooms}  |  Guests: ${quote.adults} adult(s)${quote.children ? `, ${quote.children} child(ren)` : ''}`,
    '',
    formatNightBreakdown(quote),
    '',
    `Room charges: ${formatMoney(quote.room_subtotal, quote.currency)}`,
  ]
  if (quote.extra_charges > 0) {
    lines.push(
      `Extra occupancy: ${formatMoney(quote.extra_charges, quote.currency)}${quote.extra_charges_note ? ` (${quote.extra_charges_note})` : ''}`,
    )
  }
  if (quote.tax_amount > 0) {
    lines.push(
      `Taxes / fees: ${formatMoney(quote.tax_amount, quote.currency)}${quote.tax_note ? ` (${quote.tax_note})` : ''}`,
    )
  }
  if (quote.discount_amount > 0) {
    lines.push(`Discount: -${formatMoney(quote.discount_amount, quote.currency)}`)
  }
  lines.push(`*Final total: ${formatMoney(quote.total_amount, quote.currency)}*`)
  lines.push(
    `Advance (${quote.advance_percent}%): ${formatMoney(quote.advance_amount, quote.currency)}`,
  )
  lines.push(`Balance at hotel: ${formatMoney(quote.balance_amount, quote.currency)}`)
  return lines.join('\n')
}

export function formatHotelCard(
  hotel: HotelRecord,
  room: RoomTypeRecord,
  quote: PriceQuote,
  index: number,
): string {
  const amen = (hotel.amenities ?? []).slice(0, 6).join(', ')
  const over = quote.availability_ok
    ? ''
    : '\n⚠️ Not fully available for these dates — tell me if you want nearby dates.'
  const budgetNote =
    quote.over_budget_by && quote.over_budget_by > 0
      ? `This option is ${formatMoney(quote.over_budget_by, quote.currency)} above your stated budget. I will not book it unless you agree.`
      : null
  return [
    `*${index}. ${hotel.name}*${hotel.star_rating ? ` ⭐ ${hotel.star_rating}` : ''}`,
    hotel.address || hotel.destination,
    hotel.short_description || hotel.description || '',
    amen ? `Facilities: ${amen}` : null,
    `Room: ${room.name} (up to ${room.max_occupancy} guests)`,
    `Check-in ${hotel.check_in_time}  |  Check-out ${hotel.check_out_time}`,
    formatQuote(quote),
    hotel.cancellation_policy ? `Cancellation: ${hotel.cancellation_policy}` : null,
    budgetNote,
    over,
    `Reply *${index}* to select this hotel.`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function formatBookingSummary(args: {
  quote: PriceQuote
  customerName?: string
  phone: string
  destination?: string
  policy: string
  bookingRef?: string
  deadline?: string
}): string {
  const q = args.quote
  return [
    args.bookingRef ? `Booking reference: *${args.bookingRef}*` : 'Booking summary',
    '',
    `Guest: ${args.customerName ?? '—'}`,
    `Phone: ${args.phone}`,
    args.destination ? `Destination: ${args.destination}` : null,
    formatQuote(q),
    '',
    `Cancellation: ${args.policy}`,
    args.deadline ? `Please pay the advance before ${args.deadline}.` : null,
    '',
    'Reply YES to proceed to advance payment, or tell me what to change.',
  ]
    .filter((l) => l !== null)
    .join('\n')
}

export function formatConfirmation(args: {
  bookingRef: string
  customerName: string
  hotelName: string
  address?: string | null
  hotelPhone?: string | null
  roomName: string
  rooms: number
  guests: string
  checkIn: string
  checkOut: string
  checkInTime: string
  checkOutTime: string
  nights: number
  total: string
  advance: string
  balance: string
  status: string
  policy: string
  awaitingHotel?: boolean
}): string {
  const head = args.awaitingHotel
    ? `Your payment is verified. The reservation is *awaiting hotel confirmation* — we will message you as soon as the hotel confirms.`
    : `Your booking is *confirmed*.`
  return [
    head,
    '',
    `Reference: *${args.bookingRef}*`,
    `Guest: ${args.customerName}`,
    `Hotel: ${args.hotelName}`,
    args.address ? `Address: ${args.address}` : null,
    args.hotelPhone ? `Hotel contact: ${args.hotelPhone}` : null,
    `Room: ${args.roomName} × ${args.rooms}`,
    `Guests: ${args.guests}`,
    `Check-in: ${formatDisplayDate(args.checkIn)} ${args.checkInTime}`,
    `Check-out: ${formatDisplayDate(args.checkOut)} ${args.checkOutTime}`,
    `Nights: ${args.nights}`,
    `Total: ${args.total}`,
    `Advance paid: ${args.advance}`,
    `Balance: ${args.balance} (pay at hotel unless told otherwise)`,
    `Status: ${args.status}`,
    `Policy: ${args.policy}`,
  ]
    .filter((l) => l !== null)
    .join('\n')
}
