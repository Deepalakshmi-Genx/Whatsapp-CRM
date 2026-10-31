import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { confirmHotelReservation } from '@/lib/hotel-booking/conversation'

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params

  const res = await confirmHotelReservation({
    userId: user.id,
    bookingId: id,
  })

  if (!res.ok) {
    return NextResponse.json({ error: res.error || 'Failed to confirm hotel reservation' }, { status: 400 })
  }

  return NextResponse.json({ success: true, message: 'Hotel booking successfully confirmed and customer notified via WhatsApp' })
}

