import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { upiQrPng } from '@/lib/hotel-booking/qr'

export async function GET(
  _request: Request,
  context: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await context.params
  const db = supabaseAdmin()
  const { data: payment } = await db
    .from('hotel_payments')
    .select('id, upi_link, status, expires_at')
    .eq('id', paymentId)
    .maybeSingle()

  if (!payment?.upi_link) {
    return NextResponse.json({ error: 'Payment QR not found' }, { status: 404 })
  }
  if (payment.status === 'expired' || payment.status === 'successful') {
    return NextResponse.json({ error: 'Payment is no longer payable' }, { status: 410 })
  }

  const png = await upiQrPng(payment.upi_link)
  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  })
}
