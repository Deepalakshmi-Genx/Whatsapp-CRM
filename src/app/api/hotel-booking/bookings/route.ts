import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { assertTransition } from '@/lib/hotel-booking/status'
import type { BookingStatus } from '@/lib/hotel-booking/types'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const limit = Math.min(Number(searchParams.get('limit') || 50), 100)
  const offset = Number(searchParams.get('offset') || 0)

  const db = supabaseAdmin()
  let query = db
    .from('hotel_bookings')
    .select(`
      *,
      hotels (id, name, destination, address, contact_phone),
      hotel_room_types (id, name, base_weekday_rate),
      contacts (id, name, phone)
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  const { data: bookings, error } = await query

  if (error) {
    if (error.code === 'PGRST205' || error.message.includes('hotel_bookings')) {
      return NextResponse.json({ bookings: [], migrationNeeded: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let filtered = bookings ?? []
  if (search && search.trim()) {
    const s = search.toLowerCase()
    filtered = filtered.filter((b) => {
      const ref = (b.booking_ref ?? '').toLowerCase()
      const name = (b.customer_name ?? '').toLowerCase()
      const phone = (b.customer_phone ?? '').toLowerCase()
      const hotel = ((b.hotels as Record<string, unknown>)?.name as string ?? '').toLowerCase()
      return ref.includes(s) || name.includes(s) || phone.includes(s) || hotel.includes(s)
    })
  }

  return NextResponse.json({ bookings: filtered })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || !body.id) {
    return NextResponse.json({ error: 'Missing booking id' }, { status: 400 })
  }

  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('hotel_bookings')
    .select('*')
    .eq('id', body.id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const patch: Record<string, unknown> = {}
  const toStatus = body.status as BookingStatus | undefined

  if (toStatus && toStatus !== existing.status) {
    const reason = body.reason || 'Manual status change by admin'
    try {
      assertTransition(existing.status, toStatus)
    } catch {
      if (!body.force) {
        return NextResponse.json(
          { error: `Cannot transition status from ${existing.status} to ${toStatus}. Pass force: true to override.` },
          { status: 400 }
        )
      }
    }

    patch.status = toStatus
    await db.from('hotel_status_history').insert({
      user_id: user.id,
      booking_id: existing.id,
      enquiry_id: existing.enquiry_id,
      from_status: existing.status,
      to_status: toStatus,
      reason,
      actor: `admin:${user.email || user.id}`,
    })

    if (existing.enquiry_id) {
      await db
        .from('hotel_enquiries')
        .update({ status: toStatus })
        .eq('id', existing.enquiry_id)
    }
  }

  if (body.special_requirements !== undefined) {
    patch.special_requirements = body.special_requirements
  }

  const { data: updated, error } = await db
    .from('hotel_bookings')
    .update(patch)
    .eq('id', existing.id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ booking: updated })
}
