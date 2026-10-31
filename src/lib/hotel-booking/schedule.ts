import { supabaseAdmin } from '@/lib/automations/admin-client'
import { addHours, formatDisplayDate, formatMoney } from './money'
import type { EnquiryStatus, HotelBookingSettings } from './types'
import { sendBookingText, logActivity } from './send'

export async function cancelScheduled(
  enquiryId: string | null,
  bookingId: string | null,
  kinds?: string[],
) {
  const db = supabaseAdmin()
  let q = db.from('hotel_scheduled_messages').update({ status: 'cancelled' }).eq('status', 'pending')
  if (enquiryId) q = q.eq('enquiry_id', enquiryId)
  if (bookingId) q = q.eq('booking_id', bookingId)
  if (kinds?.length) q = q.in('kind', kinds)
  await q
}

export async function scheduleFollowup(args: {
  userId: string
  enquiryId: string
  contactId: string
  conversationId: string
  status: EnquiryStatus
  settings: HotelBookingSettings
  sequence?: number
}) {
  const hoursByStatus: Partial<Record<EnquiryStatus, number>> = {
    collecting_details: args.settings.followup_details_hours,
    awaiting_budget: args.settings.followup_budget_hours,
    showing_hotel_options: args.settings.followup_options_hours,
    hotel_selected: args.settings.followup_confirm_hours,
    awaiting_customer_confirmation: args.settings.followup_confirm_hours,
    awaiting_advance_payment: args.settings.followup_payment_hours,
    payment_verification_pending: args.settings.followup_payment_hours,
    booking_pending_hotel_confirmation: 12,
  }
  const hours = hoursByStatus[args.status]
  if (!hours) return
  const sequence = args.sequence ?? 1
  if (sequence > args.settings.max_followups) return

  await cancelScheduled(args.enquiryId, null, ['followup'])
  const db = supabaseAdmin()
  await db.from('hotel_scheduled_messages').insert({
    user_id: args.userId,
    enquiry_id: args.enquiryId,
    contact_id: args.contactId,
    conversation_id: args.conversationId,
    kind: 'followup',
    sequence,
    run_at: addHours(new Date(), hours),
    payload: { status: args.status },
  })
}

export async function scheduleStayReminders(args: {
  userId: string
  bookingId: string
  enquiryId: string | null
  contactId: string
  conversationId: string
  checkIn: string
  settings: HotelBookingSettings
}) {
  await cancelScheduled(args.enquiryId, args.bookingId, [
    'pre_arrival',
    'arrival',
    'feedback',
  ])
  const db = supabaseAdmin()
  const checkInDate = new Date(`${args.checkIn}T08:00:00.000Z`)
  const pre = new Date(checkInDate)
  pre.setUTCDate(pre.getUTCDate() - args.settings.reminder_days_before_checkin)
  if (pre > new Date()) {
    await db.from('hotel_scheduled_messages').insert({
      user_id: args.userId,
      booking_id: args.bookingId,
      enquiry_id: args.enquiryId,
      contact_id: args.contactId,
      conversation_id: args.conversationId,
      kind: 'pre_arrival',
      run_at: pre.toISOString(),
    })
  }
  if (args.settings.send_checkin_day_reminder) {
    await db.from('hotel_scheduled_messages').insert({
      user_id: args.userId,
      booking_id: args.bookingId,
      enquiry_id: args.enquiryId,
      contact_id: args.contactId,
      conversation_id: args.conversationId,
      kind: 'arrival',
      run_at: checkInDate.toISOString(),
    })
  }
  if (args.settings.send_post_stay_feedback) {
    const after = new Date(`${args.checkIn}T10:00:00.000Z`)
    // scheduled relative to checkout by caller if needed; 1 day after check-in as placeholder
    after.setUTCDate(after.getUTCDate() + 1)
  }
}

export function followupCopy(status: EnquiryStatus, sequence: number): string {
  if (sequence >= 3) {
    return 'Just a final note — the room hold or this enquiry may expire if we do not hear from you. Reply anytime if you still want help booking.'
  }
  if (status === 'awaiting_advance_payment') {
    return sequence === 1
      ? 'Friendly reminder: your room is held pending the 20% advance. Reply with your UTR after paying, or tell me if you need the payment details again.'
      : 'We still have not verified the advance payment. I can resend the UPI details, or connect you with our team — just say *agent*.'
  }
  if (status === 'showing_hotel_options') {
    return 'Did any of the hotel options work for you? Reply with the hotel number, say *cheaper*, or tell me what to change.'
  }
  if (status === 'awaiting_budget') {
    return 'Whenever you are ready, share your budget (total stay or per room per night) and I will shortlist hotels.'
  }
  return 'Just checking in — I can continue your hotel booking from where we left off. Reply with the missing detail, or say *agent* for a person.'
}

export async function processDueScheduled(): Promise<number> {
  const db = supabaseAdmin()
  const { data: due } = await db
    .from('hotel_scheduled_messages')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(40)

  let processed = 0
  for (const row of due ?? []) {
    const { data: claim } = await db
      .from('hotel_scheduled_messages')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    try {
      if (row.kind === 'followup') {
        const { data: enquiry } = await db
          .from('hotel_enquiries')
          .select('*')
          .eq('id', row.enquiry_id)
          .maybeSingle()
        if (!enquiry || enquiry.human_takeover) {
          await db.from('hotel_scheduled_messages').update({ status: 'cancelled' }).eq('id', row.id)
          continue
        }
        const payloadStatus = (row.payload as { status?: EnquiryStatus })?.status
        if (payloadStatus && enquiry.status !== payloadStatus) {
          await db.from('hotel_scheduled_messages').update({ status: 'cancelled' }).eq('id', row.id)
          continue
        }
        await sendBookingText(
          {
            userId: row.user_id,
            conversationId: row.conversation_id,
            contactId: row.contact_id,
          },
          followupCopy(enquiry.status, row.sequence),
        )
        const { data: settings } = await db
          .from('hotel_booking_settings')
          .select('*')
          .eq('user_id', row.user_id)
          .maybeSingle()
        if (settings && row.sequence < settings.max_followups) {
          await scheduleFollowup({
            userId: row.user_id,
            enquiryId: row.enquiry_id,
            contactId: row.contact_id,
            conversationId: row.conversation_id,
            status: enquiry.status,
            settings: settings as HotelBookingSettings,
            sequence: row.sequence + 1,
          })
        }
      } else if (row.kind === 'pre_arrival' || row.kind === 'arrival') {
        const { data: booking } = await db
          .from('hotel_bookings')
          .select('*, hotels(name, address, check_in_time, contact_phone)')
          .eq('id', row.booking_id)
          .maybeSingle()
        if (!booking || booking.status !== 'booking_confirmed') {
          await db.from('hotel_scheduled_messages').update({ status: 'cancelled' }).eq('id', row.id)
          continue
        }
        const hotel = booking.hotels as {
          name: string
          address: string | null
          check_in_time: string
          contact_phone: string | null
        } | null
        const when = row.kind === 'arrival' ? 'today' : formatDisplayDate(booking.check_in)
        await sendBookingText(
          {
            userId: row.user_id,
            conversationId: row.conversation_id,
            contactId: row.contact_id,
          },
          [
            row.kind === 'arrival' ? 'Check-in reminder for today.' : `Upcoming stay reminder (${when}).`,
            `Reference: *${booking.booking_ref}*`,
            `Hotel: ${hotel?.name ?? ''}`,
            hotel?.address ? `Address: ${hotel.address}` : null,
            `Check-in: ${formatDisplayDate(booking.check_in)} ${hotel?.check_in_time ?? ''}`,
            `Check-out: ${formatDisplayDate(booking.check_out)}`,
            `Remaining balance: ${formatMoney(Number(booking.balance_amount), booking.currency)}`,
            hotel?.contact_phone ? `Hotel contact: ${hotel.contact_phone}` : null,
            'Need changes? Reply here or say *agent*.',
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }
      await db.from('hotel_scheduled_messages').update({ status: 'sent' }).eq('id', row.id)
      await logActivity({
        userId: row.user_id,
        enquiryId: row.enquiry_id,
        bookingId: row.booking_id,
        contactId: row.contact_id,
        eventType: `scheduled_${row.kind}`,
      })
      processed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await db
        .from('hotel_scheduled_messages')
        .update({ status: 'failed', last_error: message })
        .eq('id', row.id)
    }
  }
  return processed
}

export async function expireHoldsAndPayments(): Promise<number> {
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const { data: expired } = await db
    .from('hotel_bookings')
    .select('id, user_id, enquiry_id, status, contact_id, conversation_id')
    .in('status', ['awaiting_advance_payment', 'payment_verification_pending'])
    .lte('hold_expires_at', now)

  let n = 0
  for (const b of expired ?? []) {
    await db.from('hotel_room_holds').update({ status: 'released' }).eq('booking_id', b.id).eq('status', 'active')
    await db
      .from('hotel_payments')
      .update({ status: 'expired' })
      .eq('booking_id', b.id)
      .in('status', ['initiated', 'pending', 'verification_pending', 'customer_reported'])
    await db.from('hotel_bookings').update({ status: 'payment_expired' }).eq('id', b.id)
    if (b.enquiry_id) {
      await db.from('hotel_enquiries').update({ status: 'payment_expired' }).eq('id', b.enquiry_id)
    }
    await db.from('hotel_status_history').insert({
      user_id: b.user_id,
      booking_id: b.id,
      enquiry_id: b.enquiry_id,
      from_status: b.status,
      to_status: 'payment_expired',
      reason: 'Payment / room-hold deadline passed',
      actor: 'system',
    })
    if (b.conversation_id && b.contact_id) {
      await sendBookingText(
        {
          userId: b.user_id,
          conversationId: b.conversation_id,
          contactId: b.contact_id,
        },
        'The payment window for this room hold has expired, so the rooms were released. Reply if you still want to book and I will recheck live availability and price.',
      )
    }
    n++
  }
  return n
}
