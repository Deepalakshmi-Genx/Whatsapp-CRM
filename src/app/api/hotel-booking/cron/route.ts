import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processDueScheduled, expireHoldsAndPayments } from '@/lib/hotel-booking/schedule'

export async function POST(request: Request) {
  // Allow authorization via Bearer CRON_SECRET or authenticated Supabase user session
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  let authorized = false
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    authorized = true
  } else {
    try {
      const supabase = await createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) authorized = true
    } catch {
      // not authenticated
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const expiredCount = await expireHoldsAndPayments()
    const scheduledSentCount = await processDueScheduled()

    return NextResponse.json({
      success: true,
      expired_holds_and_payments: expiredCount,
      scheduled_messages_sent: scheduledSentCount,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return POST(request)
}

