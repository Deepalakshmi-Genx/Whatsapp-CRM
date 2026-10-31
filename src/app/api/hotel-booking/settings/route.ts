import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getOrCreateSettings } from '@/lib/hotel-booking/settings'

const FALLBACK_SETTINGS = {
  enabled: false,
  welcome_message: "Hi! Welcome to our Hotel Booking Service 😊\n\nWe're happy to help you find the perfect hotel for your trip.\n\nLet's find the best option based on your travel dates, number of guests, location, and budget.",
  budget_prompt: "Thanks! Now, what's your preferred budget for your stay?\n\nYou can share your total budget or your preferred price per room per night. I'll find the best available options for you.",
  advance_percent: 20,
  currency: 'INR',
  payment_deadline_hours: 6,
  room_hold_hours: 6,
  require_hotel_confirmation: true,
  upi_id: '',
  upi_payee_name: '',
  upi_qr_image_url: '',
  payment_instructions: 'Pay the advance via UPI using the QR code or UPI ID. After paying, send the UTR / transaction ID here. We will verify the payment before confirming the room.',
  followup_details_hours: 2,
  followup_budget_hours: 2,
  followup_options_hours: 4,
  followup_confirm_hours: 2,
  followup_payment_hours: 2,
  max_followups: 3,
  reminder_days_before_checkin: 2,
  send_checkin_day_reminder: true,
  send_post_stay_feedback: true,
  tax_label: 'GST',
  default_tax_percent: 0,
  supported_languages: ['en', 'ta', 'tanglish'],
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const settings = await getOrCreateSettings(user.id)
    return NextResponse.json({ settings, migrationNeeded: false })
  } catch (err: any) {
    const message = err?.message || String(err)
    if (message.includes('PGRST205') || message.includes('schema cache') || message.includes('hotel_booking_settings')) {
      return NextResponse.json({ settings: FALLBACK_SETTINGS, migrationNeeded: true })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const allowedFields = [
    'enabled',
    'welcome_message',
    'budget_prompt',
    'advance_percent',
    'currency',
    'payment_deadline_hours',
    'room_hold_hours',
    'require_hotel_confirmation',
    'upi_id',
    'upi_payee_name',
    'upi_qr_image_url',
    'payment_instructions',
    'followup_details_hours',
    'followup_budget_hours',
    'followup_options_hours',
    'followup_confirm_hours',
    'followup_payment_hours',
    'max_followups',
    'reminder_days_before_checkin',
    'send_checkin_day_reminder',
    'send_post_stay_feedback',
    'tax_label',
    'default_tax_percent',
    'supported_languages',
  ]

  const patch: Record<string, unknown> = {}
  for (const f of allowedFields) {
    if (f in body) {
      patch[f] = body[f]
    }
  }

  const db = supabaseAdmin()
  const { data: updated, error } = await db
    .from('hotel_booking_settings')
    .update(patch)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) {
    if (error.code === 'PGRST205') {
      return NextResponse.json(
        { error: 'Database migration required: Please run supabase/migrations/010_hotel_booking.sql in your Supabase SQL Editor.' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ settings: updated })
}
