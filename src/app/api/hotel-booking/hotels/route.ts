import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const destination = searchParams.get('destination')

  const db = supabaseAdmin()
  let query = db
    .from('hotels')
    .select(`
      *,
      hotel_room_types (*),
      hotel_photos (*),
      hotel_taxes (*),
      hotel_seasonal_rates (*)
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (destination) {
    query = query.ilike('destination', `%${destination}%`)
  }

  const { data: hotels, error } = await query

  if (error) {
    if (error.code === 'PGRST205' || error.message.includes('hotels')) {
      return NextResponse.json({ hotels: [], migrationNeeded: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ hotels: hotels ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || !body.name || !body.destination) {
    return NextResponse.json({ error: 'Hotel name and destination are required' }, { status: 400 })
  }

  const db = supabaseAdmin()

  const hotelPayload = {
    user_id: user.id,
    name: body.name.trim(),
    destination: body.destination.trim(),
    description: body.description ?? null,
    short_description: body.short_description ?? null,
    address: body.address ?? null,
    landmark: body.landmark ?? null,
    contact_phone: body.contact_phone ?? null,
    contact_email: body.contact_email ?? null,
    star_rating: body.star_rating ? Number(body.star_rating) : null,
    amenities: Array.isArray(body.amenities) ? body.amenities : [],
    cancellation_policy: body.cancellation_policy ?? 'Free cancellation up to 24 hours before check-in. After that advance is non-refundable.',
    check_in_time: body.check_in_time ?? '14:00',
    check_out_time: body.check_out_time ?? '11:00',
    min_stay_nights: Number(body.min_stay_nights || 1),
    is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
    ranking_boost: Number(body.ranking_boost || 0),
  }

  let hotelId = body.id

  if (hotelId) {
    const { error } = await db.from('hotels').update(hotelPayload).eq('id', hotelId).eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { data: newHotel, error } = await db.from('hotels').insert(hotelPayload).select('id').single()
    if (error || !newHotel) return NextResponse.json({ error: error?.message ?? 'Failed to create hotel' }, { status: 500 })
    hotelId = newHotel.id
  }

  // Room Types
  if (Array.isArray(body.room_types)) {
    for (const rt of body.room_types) {
      const roomPayload = {
        hotel_id: hotelId,
        name: rt.name,
        description: rt.description ?? null,
        max_adults: Number(rt.max_adults || 2),
        max_children: Number(rt.max_children || 2),
        max_occupancy: Number(rt.max_occupancy || 3),
        included_adults: Number(rt.included_adults || 2),
        included_children: Number(rt.included_children || 0),
        extra_adult_charge: Number(rt.extra_adult_charge || 0),
        extra_child_charge: Number(rt.extra_child_charge || 0),
        base_weekday_rate: Number(rt.base_weekday_rate || 2000),
        base_weekend_rate: rt.base_weekend_rate ? Number(rt.base_weekend_rate) : null,
        total_rooms: Number(rt.total_rooms || 1),
        amenities: Array.isArray(rt.amenities) ? rt.amenities : [],
        is_active: rt.is_active !== undefined ? Boolean(rt.is_active) : true,
      }

      if (rt.id) {
        await db.from('hotel_room_types').update(roomPayload).eq('id', rt.id).eq('hotel_id', hotelId)
      } else {
        await db.from('hotel_room_types').insert(roomPayload)
      }
    }
  }

  // Photos
  if (Array.isArray(body.photos)) {
    for (const p of body.photos) {
      if (p.image_url) {
        const photoPayload = {
          hotel_id: hotelId,
          room_type_id: p.room_type_id || null,
          category: p.category || 'other',
          image_url: p.image_url,
          caption: p.caption || null,
          position: Number(p.position || 0),
        }
        if (p.id) {
          await db.from('hotel_photos').update(photoPayload).eq('id', p.id).eq('hotel_id', hotelId)
        } else {
          await db.from('hotel_photos').insert(photoPayload)
        }
      }
    }
  }

  const { data: fullHotel } = await db
    .from('hotels')
    .select(`
      *,
      hotel_room_types (*),
      hotel_photos (*),
      hotel_taxes (*),
      hotel_seasonal_rates (*)
    `)
    .eq('id', hotelId)
    .single()

  return NextResponse.json({ hotel: fullHotel })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Hotel id required' }, { status: 400 })

  const db = supabaseAdmin()
  const { error } = await db.from('hotels').delete().eq('id', id).eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
