import { supabaseAdmin } from '@/lib/automations/admin-client'
import type {
  CollectedDetails,
  HotelBookingSettings,
  HotelRecord,
  PriceQuote,
  RateCalendarRow,
  RoomTypeRecord,
  SeasonalRateRow,
  TaxRow,
} from './types'
import { calculateQuote, occupancyFits, quoteFitsBudget } from './pricing'
import { eachStayDate } from './money'

const OCCUPYING = [
  'awaiting_advance_payment',
  'payment_verification_pending',
  'booking_pending_hotel_confirmation',
  'booking_confirmed',
  'modification_requested',
]

export interface RankedOption {
  hotel: HotelRecord
  room: RoomTypeRecord
  quote: PriceQuote
  photos: { image_url: string; caption: string | null; category: string }[]
  inBudget: boolean
}

export async function inventoryByDate(args: {
  roomTypeId: string
  totalRooms: number
  dates: string[]
  calendar: RateCalendarRow[]
}): Promise<Record<string, number>> {
  const db = supabaseAdmin()
  const start = args.dates[0]
  const end = args.dates[args.dates.length - 1]

  const { data: bookings } = await db
    .from('hotel_bookings')
    .select('check_in, check_out, rooms, room_type_id, status')
    .eq('room_type_id', args.roomTypeId)
    .in('status', OCCUPYING)
    .lt('check_in', end)
    .gt('check_out', start)

  const { data: holds } = await db
    .from('hotel_room_holds')
    .select('stay_date, rooms, status, expires_at')
    .eq('room_type_id', args.roomTypeId)
    .eq('status', 'active')
    .in('stay_date', args.dates)

  const result: Record<string, number> = {}
  for (const date of args.dates) {
    const cal = args.calendar.find((c) => c.stay_date.slice(0, 10) === date)
    let available = cal?.available_rooms ?? args.totalRooms
    if (cal?.is_closed) {
      result[date] = 0
      continue
    }
    for (const b of bookings ?? []) {
      if (b.check_in <= date && date < b.check_out) {
        available -= Number(b.rooms)
      }
    }
    for (const h of holds ?? []) {
      if (h.stay_date.slice(0, 10) === date && new Date(h.expires_at) > new Date()) {
        available -= Number(h.rooms)
      }
    }
    result[date] = Math.max(0, available)
  }
  return result
}

export async function recommendHotels(args: {
  userId: string
  details: CollectedDetails
  settings: HotelBookingSettings
  includeOverBudget?: boolean
}): Promise<RankedOption[]> {
  const db = supabaseAdmin()
  const dest = (args.details.destination ?? '').trim()
  if (!dest || !args.details.check_in || !args.details.check_out) return []

  const { data: hotels } = await db
    .from('hotels')
    .select('*')
    .eq('user_id', args.userId)
    .eq('is_active', true)

  const list = (hotels ?? []) as HotelRecord[]
  const destLower = dest.toLowerCase()
  const matched = list.filter((h) => {
    const hay = `${h.destination} ${h.address ?? ''} ${h.landmark ?? ''} ${h.name}`.toLowerCase()
    return hay.includes(destLower) || destLower.includes(h.destination.toLowerCase())
  })
  const pool = matched.length > 0 ? matched : list
  const dates = eachStayDate(args.details.check_in, args.details.check_out)
  const rooms = args.details.rooms ?? 1
  const adults = args.details.adults ?? 1
  const children = args.details.children ?? 0

  const options: RankedOption[] = []

  for (const hotel of pool) {
    const { data: roomTypes } = await db
      .from('hotel_room_types')
      .select('*')
      .eq('hotel_id', hotel.id)
      .eq('is_active', true)

    const { data: seasons } = await db
      .from('hotel_seasonal_rates')
      .select('*')
      .eq('hotel_id', hotel.id)

    const { data: taxes } = await db.from('hotel_taxes').select('*').eq('hotel_id', hotel.id)

    const { data: photos } = await db
      .from('hotel_photos')
      .select('image_url, caption, category, room_type_id, position')
      .eq('hotel_id', hotel.id)
      .order('position', { ascending: true })

    for (const room of (roomTypes ?? []) as RoomTypeRecord[]) {
      if (!occupancyFits(room, adults, children, rooms)) continue
      if (args.details.preferred_room_type) {
        const pref = args.details.preferred_room_type.toLowerCase()
        if (!room.name.toLowerCase().includes(pref) && pref.length > 2) {
          // still consider; just rank later
        }
      }

      const { data: calendar } = await db
        .from('hotel_rate_calendar')
        .select('*')
        .eq('room_type_id', room.id)
        .in('stay_date', dates)

      const inventory = await inventoryByDate({
        roomTypeId: room.id,
        totalRooms: room.total_rooms,
        dates,
        calendar: (calendar ?? []) as RateCalendarRow[],
      })

      const quote = calculateQuote({
        hotelId: hotel.id,
        hotelName: hotel.name,
        room,
        checkIn: args.details.check_in,
        checkOut: args.details.check_out,
        rooms,
        adults,
        children,
        calendar: (calendar ?? []) as RateCalendarRow[],
        seasons: (seasons ?? []) as SeasonalRateRow[],
        taxes: (taxes ?? []) as TaxRow[],
        settings: args.settings,
        cancellationPolicy: hotel.cancellation_policy,
        inventoryByDate: inventory,
      })

      if (!quote.availability_ok) continue

      const fit = quoteFitsBudget(
        quote,
        args.details.budget_amount,
        args.details.budget_type,
        args.details.budget_max,
      )
      quote.over_budget_by = fit.ok ? undefined : fit.overBy
      if (!fit.ok && !args.details.budget_flexible && !args.includeOverBudget) continue

      const roomPhotos = (photos ?? []).filter(
        (p) => !p.room_type_id || p.room_type_id === room.id,
      )

      options.push({
        hotel,
        room,
        quote,
        photos: roomPhotos.slice(0, 6),
        inBudget: fit.ok,
      })
    }
  }

  options.sort((a, b) => {
    if (a.inBudget !== b.inBudget) return a.inBudget ? -1 : 1
    const boost = (b.hotel.ranking_boost ?? 0) - (a.hotel.ranking_boost ?? 0)
    if (boost) return boost
    const stars = (b.hotel.star_rating ?? 0) - (a.hotel.star_rating ?? 0)
    if (stars) return stars
    return a.quote.total_amount - b.quote.total_amount
  })

  return options.slice(0, 5)
}

export async function quoteForSelection(args: {
  userId: string
  hotelId: string
  roomTypeId: string
  details: CollectedDetails
  settings: HotelBookingSettings
}): Promise<RankedOption | null> {
  const all = await recommendHotels({
    userId: args.userId,
    details: { ...args.details, selected_hotel_id: args.hotelId },
    settings: args.settings,
    includeOverBudget: true,
  })
  return (
    all.find((o) => o.hotel.id === args.hotelId && o.room.id === args.roomTypeId) ??
    all.find((o) => o.hotel.id === args.hotelId) ??
    null
  )
}
