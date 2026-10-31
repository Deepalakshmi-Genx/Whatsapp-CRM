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
  const status = searchParams.get('status')
  const limit = Math.min(Number(searchParams.get('limit') || 50), 100)
  const offset = Number(searchParams.get('offset') || 0)

  const db = supabaseAdmin()
  let query = db
    .from('hotel_payments')
    .select(`
      *,
      hotel_bookings (
        id,
        booking_ref,
        customer_name,
        customer_phone,
        total_amount,
        advance_amount,
        balance_amount,
        hotels (name)
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  const { data: payments, error } = await query

  if (error) {
    if (error.code === 'PGRST205' || error.message.includes('hotel_payments')) {
      return NextResponse.json({ payments: [], migrationNeeded: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ payments: payments ?? [] })
}
