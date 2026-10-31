import { supabaseAdmin } from '@/lib/automations/admin-client'
import { addHours, formatMoney } from './money'
import type { BookingRecord, HotelBookingSettings, PriceQuote } from './types'
import { sendBookingImage, sendBookingText, logActivity, notifyAdmin } from './send'
import { assertTransition } from './status'

export function buildUpiLink(args: {
  upiId: string
  payeeName: string
  amount: number
  ref: string
}): string {
  const params = new URLSearchParams({
    pa: args.upiId,
    pn: args.payeeName,
    am: args.amount.toFixed(2),
    cu: 'INR',
    tn: args.ref,
  })
  return `upi://pay?${params.toString()}`
}

export async function createAdvancePayment(args: {
  booking: BookingRecord
  quote: PriceQuote
  settings: HotelBookingSettings
  conversationId: string
  contactId: string
}): Promise<{ paymentId: string; deadline: string }> {
  const db = supabaseAdmin()
  const deadline = addHours(new Date(), args.settings.payment_deadline_hours)
  const holdUntil = addHours(new Date(), args.settings.room_hold_hours)

  await db
    .from('hotel_payments')
    .update({ status: 'expired' })
    .eq('booking_id', args.booking.id)
    .eq('kind', 'advance')
    .in('status', ['initiated', 'pending', 'customer_reported', 'verification_pending'])

  const upiLink =
    args.settings.upi_id
      ? buildUpiLink({
          upiId: args.settings.upi_id,
          payeeName: args.settings.upi_payee_name || 'Hotel Booking',
          amount: args.quote.advance_amount,
          ref: args.booking.booking_ref,
        })
      : null

  const { data: payment, error } = await db
    .from('hotel_payments')
    .insert({
      user_id: args.booking.user_id,
      booking_id: args.booking.id,
      kind: 'advance',
      expected_amount: args.quote.advance_amount,
      currency: args.quote.currency,
      status: 'initiated',
      upi_id: args.settings.upi_id,
      upi_link: upiLink,
      expires_at: deadline,
    })
    .select('id')
    .single()
  if (error || !payment) throw new Error(error?.message ?? 'payment insert failed')

  await db
    .from('hotel_bookings')
    .update({
      payment_deadline_at: deadline,
      hold_expires_at: holdUntil,
      price_locked: true,
      quoted_at: new Date().toISOString(),
    })
    .eq('id', args.booking.id)

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
  const qrUrl =
    args.settings.upi_qr_image_url ||
    (appUrl ? `${appUrl.replace(/\/$/, '')}/api/hotel-booking/upi-qr/${payment.id}` : null)

  const text = [
    `Please pay the *20% advance* to hold this room.`,
    '',
    `Amount: *${formatMoney(args.quote.advance_amount, args.quote.currency)}*`,
    `Booking reference: *${args.booking.booking_ref}*`,
    args.settings.upi_id ? `UPI ID: ${args.settings.upi_id}` : null,
    args.settings.upi_payee_name ? `Payee: ${args.settings.upi_payee_name}` : null,
    `Pay by: ${new Date(deadline).toLocaleString('en-IN')}`,
    '',
    args.settings.payment_instructions,
    '',
    'After paying, send the UTR / UPI transaction ID here.',
    'A screenshot alone is not enough — we verify the transaction before confirming.',
    'If you have a payment issue, reply *agent*.',
  ]
    .filter(Boolean)
    .join('\n')

  const target = {
    userId: args.booking.user_id,
    conversationId: args.conversationId,
    contactId: args.contactId,
  }
  if (qrUrl) {
    try {
      await sendBookingImage(target, qrUrl, text)
    } catch {
      await sendBookingText(target, text)
    }
  } else {
    await sendBookingText(target, text)
  }

  await logActivity({
    userId: args.booking.user_id,
    bookingId: args.booking.id,
    enquiryId: args.booking.enquiry_id,
    contactId: args.contactId,
    eventType: 'payment_instructions_sent',
    detail: `Advance ${args.quote.advance_amount} requested`,
  })

  return { paymentId: payment.id, deadline }
}

const UTR_RE = /\b(?:utr|txn|trxn|transaction|ref)[:\s#\-]*([A-Za-z0-9]{8,22})\b/i
const BARE_UTR_RE = /\b[A-Z0-9]{12,22}\b/

export function extractTransactionRef(text: string): string | null {
  const labeled = text.match(UTR_RE)
  if (labeled) return labeled[1].toUpperCase()
  const bare = text.toUpperCase().match(BARE_UTR_RE)
  return bare ? bare[0] : null
}

export async function recordCustomerPaymentClaim(args: {
  userId: string
  bookingId: string
  enquiryId: string | null
  contactId: string
  conversationId: string
  text: string
  hasMedia: boolean
}): Promise<void> {
  const db = supabaseAdmin()
  const ref = extractTransactionRef(args.text)
  const { data: payment } = await db
    .from('hotel_payments')
    .select('*')
    .eq('booking_id', args.bookingId)
    .eq('kind', 'advance')
    .in('status', ['initiated', 'pending', 'customer_reported', 'verification_pending'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!payment) {
    await sendBookingText(
      {
        userId: args.userId,
        conversationId: args.conversationId,
        contactId: args.contactId,
      },
      'I cannot find a pending advance payment for this booking. If you already paid, reply *agent* and we will check.',
    )
    return
  }

  await db
    .from('hotel_payments')
    .update({
      status: 'verification_pending',
      transaction_ref: ref,
      customer_note: args.text.slice(0, 500),
    })
    .eq('id', payment.id)

  const { data: booking } = await db
    .from('hotel_bookings')
    .select('status')
    .eq('id', args.bookingId)
    .single()
  if (booking) {
    assertTransition(booking.status, 'payment_verification_pending')
    await db
      .from('hotel_bookings')
      .update({ status: 'payment_verification_pending' })
      .eq('id', args.bookingId)
    await db.from('hotel_enquiries').update({ status: 'payment_verification_pending' }).eq('id', args.enquiryId)
    await db.from('hotel_status_history').insert({
      user_id: args.userId,
      booking_id: args.bookingId,
      enquiry_id: args.enquiryId,
      from_status: booking.status,
      to_status: 'payment_verification_pending',
      reason: 'Customer reported payment',
      actor: 'customer',
    })
  }

  const screenshotNote = args.hasMedia
    ? ' I received your screenshot, but a screenshot is not treated as verified payment.'
    : ''
  await sendBookingText(
    {
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
    },
    `Thanks. Your payment is marked as *pending verification*${ref ? ` (ref ${ref})` : ''}.${screenshotNote} Our team will confirm it against the bank/UPI record and then send your booking confirmation.`,
  )

  await notifyAdmin({
    userId: args.userId,
    title: 'Advance payment needs verification',
    body: ref ? `Customer sent UTR ${ref}` : 'Customer reported payment without a clear UTR',
    eventType: 'payment_verification_pending',
    bookingId: args.bookingId,
    enquiryId: args.enquiryId,
  })
  await logActivity({
    userId: args.userId,
    bookingId: args.bookingId,
    enquiryId: args.enquiryId,
    contactId: args.contactId,
    eventType: 'payment_customer_reported',
    detail: ref ?? 'no UTR',
  })
}
