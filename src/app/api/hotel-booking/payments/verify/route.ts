import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { finalizeVerifiedPayment } from '@/lib/hotel-booking/conversation'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || !body.paymentId) {
    return NextResponse.json({ error: 'Missing paymentId' }, { status: 400 })
  }

  const result = await finalizeVerifiedPayment({
    userId: user.id,
    paymentId: body.paymentId,
    actorId: user.id,
    transactionRef: body.transactionRef ? String(body.transactionRef).trim() : undefined,
    receivedAmount: body.receivedAmount != null ? Number(body.receivedAmount) : undefined,
    notes: body.notes ? String(body.notes).trim() : undefined,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Payment verification failed' }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    message: 'Payment successfully verified, booking updated and WhatsApp confirmation issued',
  })
}

