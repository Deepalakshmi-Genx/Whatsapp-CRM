import { supabaseAdmin } from '@/lib/automations/admin-client'
import type {
  BookingRecord,
  CollectedDetails,
  EnquiryRecord,
  EnquiryStatus,
  HotelBookingSettings,
  PriceQuote,
} from './types'
import { OPEN_ENQUIRY_STATUSES } from './types'
import { classifyIntent } from './intent'
import { extractBudget, extractDetails, mergeCollected, missingRequired } from './extract'
import { validateStayDates } from './pricing'
import { eachStayDate, formatMoney, nightsBetween } from './money'
import {
  formatBookingSummary,
  formatConfirmation,
  formatDetailsSummary,
  formatHotelCard,
  formatQuote,
} from './format'
import { quoteForSelection, recommendHotels } from './recommend'
import {
  logActivity,
  notifyAdmin,
  sendBookingButtons,
  sendBookingImage,
  sendBookingList,
  sendBookingText,
} from './send'
import { getOrCreateSettings } from './settings'
import { createAdvancePayment, recordCustomerPaymentClaim } from './payments'
import { cancelScheduled, scheduleFollowup, scheduleStayReminders } from './schedule'
import { assertTransition } from './status'

export interface InboundHotelMessage {
  userId: string
  contactId: string
  conversationId: string
  phone: string
  contactName: string
  text: string
  interactiveId?: string
  hasMedia: boolean
  messageId: string
}

const QUESTIONS: Record<string, string> = {
  customer_name: 'May I have your name?',
  destination: 'Which city or area would you like to stay in?',
  check_in: 'What is your check-in date? (DD/MM/YYYY)',
  check_out: 'What is your check-out date? (DD/MM/YYYY)',
  adults: 'How many adults will be staying?',
  rooms: 'How many rooms do you need?',
}

function target(msg: InboundHotelMessage) {
  return {
    userId: msg.userId,
    conversationId: msg.conversationId,
    contactId: msg.contactId,
  }
}

async function setStatus(
  enquiry: EnquiryRecord,
  to: EnquiryStatus,
  reason: string,
  actor = 'system',
) {
  assertTransition(enquiry.status, to)
  const db = supabaseAdmin()
  await db.from('hotel_enquiries').update({ status: to }).eq('id', enquiry.id)
  await db.from('hotel_status_history').insert({
    user_id: enquiry.user_id,
    enquiry_id: enquiry.id,
    from_status: enquiry.status,
    to_status: to,
    reason,
    actor,
  })
  enquiry.status = to
}

async function saveCollected(enquiry: EnquiryRecord, collected: CollectedDetails) {
  const db = supabaseAdmin()
  enquiry.collected = collected
  await db.from('hotel_enquiries').update({ collected }).eq('id', enquiry.id)
}

function bookingRef(): string {
  const d = new Date()
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `HB-${ymd}-${rand}`
}

async function loadOpenEnquiry(userId: string, contactId: string): Promise<EnquiryRecord | null> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('hotel_enquiries')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .in('status', OPEN_ENQUIRY_STATUSES)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as EnquiryRecord | null) ?? null
}

async function createEnquiry(msg: InboundHotelMessage): Promise<EnquiryRecord> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('hotel_enquiries')
    .insert({
      user_id: msg.userId,
      contact_id: msg.contactId,
      conversation_id: msg.conversationId,
      status: 'new_enquiry',
      collected: { contact_number: msg.phone, customer_name: msg.contactName || undefined },
      last_inbound_message_id: msg.messageId,
      last_customer_message_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'enquiry insert failed')
  await notifyAdmin({
    userId: msg.userId,
    title: 'New hotel enquiry',
    body: `${msg.contactName || msg.phone} started a WhatsApp enquiry`,
    eventType: 'new_enquiry',
    enquiryId: data.id,
  })
  return data as EnquiryRecord
}

async function askNext(enquiry: EnquiryRecord, msg: InboundHotelMessage, settings: HotelBookingSettings) {
  const missing = missingRequired(enquiry.collected)
  if (missing.length === 0) {
    await setStatus(enquiry, 'collecting_details', 'details complete, awaiting confirmation')
    await sendBookingButtons(
      target(msg),
      formatDetailsSummary(enquiry.collected, msg.phone),
      [
        { id: 'confirm_yes', title: 'Yes, correct' },
        { id: 'confirm_no', title: 'Need changes' },
        { id: 'talk_human', title: 'Talk to agent' },
      ],
    )
    await scheduleFollowup({
      userId: msg.userId,
      enquiryId: enquiry.id,
      contactId: msg.contactId,
      conversationId: msg.conversationId,
      status: enquiry.status,
      settings,
    })
    return
  }
  const field = missing[0]
  await setStatus(enquiry, 'collecting_details', `asking ${field}`)
  await sendBookingText(target(msg), QUESTIONS[field] ?? 'Could you share a bit more detail?')
  await supabaseAdmin()
    .from('hotel_enquiries')
    .update({ last_question: field, last_bot_message_at: new Date().toISOString() })
    .eq('id', enquiry.id)
  await scheduleFollowup({
    userId: msg.userId,
    enquiryId: enquiry.id,
    contactId: msg.contactId,
    conversationId: msg.conversationId,
    status: 'collecting_details',
    settings,
  })
}

async function sendRecommendations(
  enquiry: EnquiryRecord,
  msg: InboundHotelMessage,
  settings: HotelBookingSettings,
  includeOverBudget = false,
) {
  const options = await recommendHotels({
    userId: msg.userId,
    details: enquiry.collected,
    settings,
    includeOverBudget,
  })
  if (options.length === 0) {
    await sendBookingText(
      target(msg),
      includeOverBudget
        ? 'I do not have available rooms that match these dates, guest count, and location in our inventory. I am connecting you with our team so they can check partner hotels.'
        : 'Nothing is available within that budget for those dates. Reply *flex* if nearby prices are okay, or share a higher budget. I will not silently exceed your budget.',
    )
    if (includeOverBudget) {
      await handover(enquiry, msg, 'No matching inventory')
    }
    return
  }

  const inBudget = options.filter((o) => o.inBudget)
  const show = (inBudget.length ? inBudget : options).slice(0, 3)
  if (!inBudget.length) {
    await sendBookingText(
      target(msg),
      'I could not find a hotel fully inside your budget. Here are the closest available options — the extra amount is shown on each card. Reply with a number only if you accept the higher price.',
    )
  }

  enquiry.collected.recommended_ids = show.map((o) => `${o.hotel.id}:${o.room.id}`)
  await saveCollected(enquiry, enquiry.collected)
  await setStatus(enquiry, 'showing_hotel_options', 'sent hotel options')

  for (let i = 0; i < show.length; i++) {
    const opt = show[i]
    const card = formatHotelCard(opt.hotel, opt.room, opt.quote, i + 1)
    const photo = opt.photos[0]
    if (photo?.image_url) {
      try {
        await sendBookingImage(target(msg), photo.image_url, card)
      } catch {
        await sendBookingText(target(msg), card)
      }
    } else {
      await sendBookingText(target(msg), card)
    }
  }

  await sendBookingList(
    target(msg),
    'Select a hotel, ask for more photos, cheaper options, or changes.',
    'Choose hotel',
    show.map((o, i) => ({
      id: `select_hotel:${i + 1}`,
      title: `${i + 1}. ${o.hotel.name}`.slice(0, 24),
      description: formatMoney(o.quote.total_amount, o.quote.currency),
    })),
  )

  await logActivity({
    userId: msg.userId,
    enquiryId: enquiry.id,
    contactId: msg.contactId,
    eventType: 'hotels_recommended',
    detail: show.map((o) => o.hotel.name).join(', '),
  })
  await scheduleFollowup({
    userId: msg.userId,
    enquiryId: enquiry.id,
    contactId: msg.contactId,
    conversationId: msg.conversationId,
    status: 'showing_hotel_options',
    settings,
  })
}

async function selectOption(
  enquiry: EnquiryRecord,
  msg: InboundHotelMessage,
  settings: HotelBookingSettings,
  index: number,
) {
  const rec = enquiry.collected.recommended_ids ?? []
  const pair = rec[index - 1]
  if (!pair) {
    await sendBookingText(target(msg), 'Please reply with a hotel number from the list I sent.')
    return
  }
  const [hotelId, roomTypeId] = pair.split(':')
  const option = await quoteForSelection({
    userId: msg.userId,
    hotelId,
    roomTypeId,
    details: enquiry.collected,
    settings,
  })
  if (!option || !option.quote.availability_ok) {
    await sendBookingText(
      target(msg),
      'That room is no longer available for every night of your stay. I will refresh the list.',
    )
    await sendRecommendations(enquiry, msg, settings, true)
    return
  }
  if (option.quote.over_budget_by && option.quote.over_budget_by > 0) {
    await sendBookingText(
      target(msg),
      `This hotel is ${formatMoney(option.quote.over_budget_by, option.quote.currency)} above your budget. Reply YES if you still want it, or ask for cheaper options.`,
    )
  }

  enquiry.collected.selected_hotel_id = hotelId
  enquiry.collected.selected_room_type_id = option.room.id
  enquiry.collected.last_quote = option.quote
  enquiry.collected.photo_index = 1
  await saveCollected(enquiry, enquiry.collected)
  await setStatus(enquiry, 'hotel_selected', `selected ${option.hotel.name}`)

  const extraPhotos = option.photos.slice(1, 4)
  for (const p of extraPhotos) {
    try {
      await sendBookingImage(target(msg), p.image_url, p.caption || option.hotel.name)
    } catch {
      /* photo optional */
    }
  }

  const deadline = new Date(
    Date.now() + settings.payment_deadline_hours * 3600_000,
  ).toLocaleString('en-IN')
  await sendBookingButtons(
    target(msg),
    formatBookingSummary({
      quote: option.quote,
      customerName: enquiry.collected.customer_name,
      phone: msg.phone,
      destination: enquiry.collected.destination,
      policy: option.hotel.cancellation_policy,
      deadline,
    }),
    [
      { id: 'confirm_yes', title: 'Confirm' },
      { id: 'other_hotels', title: 'Other hotels' },
      { id: 'more_photos', title: 'More photos' },
    ],
  )
  await setStatus(enquiry, 'awaiting_customer_confirmation', 'summary sent')
  await scheduleFollowup({
    userId: msg.userId,
    enquiryId: enquiry.id,
    contactId: msg.contactId,
    conversationId: msg.conversationId,
    status: 'awaiting_customer_confirmation',
    settings,
  })
}

async function placeHold(bookingId: string, roomTypeId: string, checkIn: string, checkOut: string, rooms: number, hours: number) {
  const db = supabaseAdmin()
  const dates = eachStayDate(checkIn, checkOut)
  const expires = new Date(Date.now() + hours * 3600_000).toISOString()
  await db.from('hotel_room_holds').insert(
    dates.map((stay_date) => ({
      booking_id: bookingId,
      room_type_id: roomTypeId,
      stay_date,
      rooms,
      status: 'active',
      expires_at: expires,
    })),
  )
}

async function confirmAndPay(
  enquiry: EnquiryRecord,
  msg: InboundHotelMessage,
  settings: HotelBookingSettings,
) {
  const quote = enquiry.collected.last_quote
  const hotelId = enquiry.collected.selected_hotel_id
  const roomTypeId = enquiry.collected.selected_room_type_id
  if (!quote || !hotelId || !roomTypeId || !enquiry.collected.check_in || !enquiry.collected.check_out) {
    await sendBookingText(target(msg), 'I need to refresh availability before booking. Let me send options again.')
    await sendRecommendations(enquiry, msg, settings, true)
    return
  }

  const fresh = await quoteForSelection({
    userId: msg.userId,
    hotelId,
    roomTypeId,
    details: enquiry.collected,
    settings,
  })
  if (!fresh?.quote.availability_ok) {
    await sendBookingText(
      target(msg),
      'Availability changed before confirmation. I will not book a room that is not actually free.',
    )
    await sendRecommendations(enquiry, msg, settings, true)
    return
  }
  if (fresh.quote.total_amount !== quote.total_amount) {
    enquiry.collected.last_quote = fresh.quote
    await saveCollected(enquiry, enquiry.collected)
    await sendBookingText(
      target(msg),
      `The price changed since the last quote.\n\n${formatQuote(fresh.quote)}\n\nReply YES if you still want to proceed.`,
    )
    return
  }

  const db = supabaseAdmin()
  const ref = bookingRef()
  const { data: booking, error } = await db
    .from('hotel_bookings')
    .insert({
      user_id: msg.userId,
      enquiry_id: enquiry.id,
      contact_id: msg.contactId,
      conversation_id: msg.conversationId,
      hotel_id: hotelId,
      room_type_id: roomTypeId,
      booking_ref: ref,
      status: 'awaiting_advance_payment',
      customer_name: enquiry.collected.customer_name,
      customer_phone: msg.phone,
      destination: enquiry.collected.destination,
      check_in: enquiry.collected.check_in,
      check_out: enquiry.collected.check_out,
      nights: nightsBetween(enquiry.collected.check_in, enquiry.collected.check_out),
      adults: enquiry.collected.adults ?? 1,
      children: enquiry.collected.children ?? 0,
      child_ages: enquiry.collected.child_ages ?? [],
      rooms: enquiry.collected.rooms ?? 1,
      special_requirements: enquiry.collected.special_requirements ?? null,
      currency: fresh.quote.currency,
      night_rates: fresh.quote.night_rates,
      room_subtotal: fresh.quote.room_subtotal,
      extra_charges: fresh.quote.extra_charges,
      tax_amount: fresh.quote.tax_amount,
      discount_amount: fresh.quote.discount_amount,
      total_amount: fresh.quote.total_amount,
      advance_percent: fresh.quote.advance_percent,
      advance_amount: fresh.quote.advance_amount,
      balance_amount: fresh.quote.balance_amount,
      cancellation_policy: fresh.hotel.cancellation_policy,
      price_locked: true,
      quoted_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error || !booking) {
    await sendBookingText(target(msg), 'I could not create the booking record. Connecting you with our team.')
    await handover(enquiry, msg, 'booking insert failed')
    return
  }

  await placeHold(
    booking.id,
    roomTypeId,
    enquiry.collected.check_in,
    enquiry.collected.check_out,
    enquiry.collected.rooms ?? 1,
    settings.room_hold_hours,
  )
  await setStatus(enquiry, 'awaiting_advance_payment', 'awaiting 20% advance')
  await createAdvancePayment({
    booking: booking as BookingRecord,
    quote: fresh.quote,
    settings,
    conversationId: msg.conversationId,
    contactId: msg.contactId,
  })
  await notifyAdmin({
    userId: msg.userId,
    title: 'Advance payment requested',
    body: `${ref} — ${formatMoney(fresh.quote.advance_amount, fresh.quote.currency)}`,
    eventType: 'awaiting_advance_payment',
    bookingId: booking.id,
    enquiryId: enquiry.id,
  })
  await scheduleFollowup({
    userId: msg.userId,
    enquiryId: enquiry.id,
    contactId: msg.contactId,
    conversationId: msg.conversationId,
    status: 'awaiting_advance_payment',
    settings,
  })
}

async function handover(enquiry: EnquiryRecord, msg: InboundHotelMessage, reason: string) {
  const db = supabaseAdmin()
  await db
    .from('hotel_enquiries')
    .update({ human_takeover: true, handover_reason: reason })
    .eq('id', enquiry.id)
  enquiry.human_takeover = true
  await cancelScheduled(enquiry.id, null)
  await sendBookingText(
    target(msg),
    'I am connecting you with our booking team. They can see this full conversation and your details. Please wait here.',
  )
  await notifyAdmin({
    userId: msg.userId,
    title: 'Human handover',
    body: reason,
    eventType: 'handover',
    enquiryId: enquiry.id,
  })
  await logActivity({
    userId: msg.userId,
    enquiryId: enquiry.id,
    contactId: msg.contactId,
    eventType: 'handover',
    detail: reason,
  })
}

async function handleCancellation(enquiry: EnquiryRecord, msg: InboundHotelMessage) {
  const db = supabaseAdmin()
  const { data: booking } = await db
    .from('hotel_bookings')
    .select('*')
    .eq('enquiry_id', enquiry.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!booking) {
    await setStatus(enquiry, 'cancelled', 'enquiry cancelled before booking', 'customer')
    await cancelScheduled(enquiry.id, null)
    await sendBookingText(target(msg), 'This enquiry is cancelled. Message us anytime to start a new booking.')
    return
  }

  await db.from('hotel_bookings').update({ status: 'cancellation_requested' }).eq('id', booking.id)
  await setStatus(enquiry, 'cancellation_requested', 'customer requested cancel', 'customer')
  const policy = booking.cancellation_policy || 'The hotel policy will determine any refund of the advance.'
  await sendBookingButtons(
    target(msg),
    [
      `Cancellation request for *${booking.booking_ref}*.`,
      '',
      `Policy: ${policy}`,
      '',
      'I will not promise a refund amount until the hotel confirms the outcome.',
      'Reply YES to submit the cancellation, or NO to keep the booking.',
    ].join('\n'),
    [
      { id: 'cancel_yes', title: 'Yes, cancel' },
      { id: 'cancel_no', title: 'Keep booking' },
    ],
  )
}

async function submitCancel(enquiry: EnquiryRecord, msg: InboundHotelMessage) {
  const db = supabaseAdmin()
  const { data: booking } = await db
    .from('hotel_bookings')
    .select('*')
    .eq('enquiry_id', enquiry.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!booking) return
  await db.from('hotel_room_holds').update({ status: 'released' }).eq('booking_id', booking.id).eq('status', 'active')
  const paid = await db
    .from('hotel_payments')
    .select('id')
    .eq('booking_id', booking.id)
    .eq('status', 'successful')
    .limit(1)
  const next: EnquiryStatus = (paid.data && paid.data.length > 0) ? 'refund_pending' : 'cancelled'
  await db.from('hotel_bookings').update({ status: next, cancel_reason: 'Customer request via WhatsApp' }).eq('id', booking.id)
  await setStatus(enquiry, next, 'cancellation submitted', 'customer')
  await cancelScheduled(enquiry.id, booking.id)
  await sendBookingText(
    target(msg),
    next === 'refund_pending'
      ? `Cancellation submitted for *${booking.booking_ref}*. Refund is *pending review* against the hotel policy. We will message you with the actual outcome — not an estimated refund.`
      : `Booking *${booking.booking_ref}* is cancelled and the room hold is released.`,
  )
  await notifyAdmin({
    userId: msg.userId,
    title: 'Cancellation',
    body: `${booking.booking_ref} → ${next}`,
    eventType: 'cancellation',
    bookingId: booking.id,
    enquiryId: enquiry.id,
  })
}

function parseIndex(text: string, interactiveId?: string): number | null {
  if (interactiveId?.startsWith('select_hotel:')) {
    return Number(interactiveId.split(':')[1])
  }
  const m = text.trim().match(/^([1-5])$/)
  return m ? Number(m[1]) : null
}

export async function handleHotelInbound(msg: InboundHotelMessage): Promise<boolean> {
  const settings = await getOrCreateSettings(msg.userId)
  if (!settings.enabled) return false

  const db = supabaseAdmin()
  let enquiry = await loadOpenEnquiry(msg.userId, msg.contactId)

  if (enquiry?.last_inbound_message_id === msg.messageId) return true

  if (enquiry) {
    await db
      .from('hotel_enquiries')
      .update({
        last_inbound_message_id: msg.messageId,
        last_customer_message_at: new Date().toISOString(),
      })
      .eq('id', enquiry.id)
  }

  const intent = classifyIntent(msg.text, msg.interactiveId)

  if (enquiry?.human_takeover && intent !== 'new_booking') {
    await logActivity({
      userId: msg.userId,
      enquiryId: enquiry.id,
      contactId: msg.contactId,
      eventType: 'human_queue_inbound',
      detail: msg.text.slice(0, 200),
    })
    return true
  }

  if (!enquiry) {
    enquiry = await createEnquiry(msg)
    await sendBookingText(target(msg), settings.welcome_message)
    const extracted = extractDetails(msg.text, enquiry.collected)
    enquiry.collected = mergeCollected(enquiry.collected, extracted)
    if (!enquiry.collected.customer_name && msg.contactName) {
      enquiry.collected.customer_name = msg.contactName
    }
    await saveCollected(enquiry, enquiry.collected)
    await askNext(enquiry, msg, settings)
    return true
  }

  await cancelScheduled(enquiry.id, null, ['followup'])

  if (intent === 'human' || msg.interactiveId === 'talk_human') {
    await handover(enquiry, msg, 'Customer requested a person')
    return true
  }
  if (intent === 'opt_out') {
    await cancelScheduled(enquiry.id, null)
    await sendBookingText(target(msg), 'Okay — I will stop booking reminders. You can message anytime to continue.')
    return true
  }
  if (intent === 'cancellation' || msg.interactiveId === 'cancel_yes') {
    if (msg.interactiveId === 'cancel_yes' || enquiry.status === 'cancellation_requested') {
      await submitCancel(enquiry, msg)
    } else {
      await handleCancellation(enquiry, msg)
    }
    return true
  }
  if (msg.interactiveId === 'cancel_no') {
    await sendBookingText(target(msg), 'Okay, keeping the booking as is.')
    return true
  }

  if (intent === 'payment_confirmation' || enquiry.status === 'awaiting_advance_payment' || enquiry.status === 'payment_verification_pending') {
    const { data: booking } = await db
      .from('hotel_bookings')
      .select('id')
      .eq('enquiry_id', enquiry.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (booking) {
      const looksLikePayment =
        intent === 'payment_confirmation' ||
        msg.hasMedia ||
        /\b(?:utr|txn|trxn|transaction)[:\s#\-]*[A-Za-z0-9]{8,}\b/i.test(msg.text) ||
        /\b[A-Z0-9]{12,22}\b/.test(msg.text.toUpperCase())
      if (looksLikePayment) {
        await recordCustomerPaymentClaim({
          userId: msg.userId,
          bookingId: booking.id,
          enquiryId: enquiry.id,
          contactId: msg.contactId,
          conversationId: msg.conversationId,
          text: msg.text,
          hasMedia: msg.hasMedia,
        })
        return true
      }
    }
  }

  if (intent === 'show_photos' || msg.interactiveId === 'more_photos') {
    const hotelId = enquiry.collected.selected_hotel_id
    if (!hotelId) {
      await sendBookingText(target(msg), 'Select a hotel first, then I can send more photos of that property only.')
      return true
    }
    const start = enquiry.collected.photo_index ?? 0
    const { data: photos } = await db
      .from('hotel_photos')
      .select('image_url, caption, hotel_id')
      .eq('hotel_id', hotelId)
      .order('position')
    const slice = (photos ?? []).slice(start, start + 3)
    if (!slice.length) {
      await sendBookingText(target(msg), 'No further photos for this hotel.')
      return true
    }
    for (const p of slice) {
      try {
        await sendBookingImage(target(msg), p.image_url, p.caption || '')
      } catch {
        /* ignore */
      }
    }
    enquiry.collected.photo_index = start + slice.length
    await saveCollected(enquiry, enquiry.collected)
    return true
  }

  if (intent === 'cheaper' || intent === 'compare' || msg.interactiveId === 'other_hotels') {
    await sendRecommendations(enquiry, msg, settings, intent === 'cheaper')
    return true
  }

  if (intent === 'modification') {
    const patch = extractDetails(msg.text, enquiry.collected)
    enquiry.collected = mergeCollected(enquiry.collected, patch)
    enquiry.collected.details_confirmed = false
    await saveCollected(enquiry, enquiry.collected)
    await sendBookingText(target(msg), 'Updated. I will recheck availability and price.')
    const missing = missingRequired(enquiry.collected)
    if (missing.length) {
      await askNext(enquiry, msg, settings)
    } else if (enquiry.collected.budget_amount) {
      await sendRecommendations(enquiry, msg, settings)
    } else {
      await askNext(enquiry, msg, settings)
    }
    return true
  }

  const idx = parseIndex(msg.text, msg.interactiveId)
  if (idx && (enquiry.status === 'showing_hotel_options' || enquiry.status === 'hotel_selected')) {
    await selectOption(enquiry, msg, settings, idx)
    return true
  }

  if (
    (intent === 'affirm' || msg.interactiveId === 'confirm_yes') &&
    enquiry.status === 'collecting_details'
  ) {
    const dateErr =
      enquiry.collected.check_in && enquiry.collected.check_out
        ? validateStayDates(enquiry.collected.check_in, enquiry.collected.check_out)
        : 'Dates are missing.'
    if (dateErr) {
      await sendBookingText(target(msg), dateErr)
      return true
    }
    enquiry.collected.details_confirmed = true
    await saveCollected(enquiry, enquiry.collected)
    await setStatus(enquiry, 'awaiting_budget', 'details confirmed')
    await sendBookingText(target(msg), settings.budget_prompt)
    await scheduleFollowup({
      userId: msg.userId,
      enquiryId: enquiry.id,
      contactId: msg.contactId,
      conversationId: msg.conversationId,
      status: 'awaiting_budget',
      settings,
    })
    return true
  }

  if (
    (intent === 'affirm' || msg.interactiveId === 'confirm_yes') &&
    enquiry.status === 'awaiting_customer_confirmation'
  ) {
    await confirmAndPay(enquiry, msg, settings)
    return true
  }

  if (intent === 'deny' || msg.interactiveId === 'confirm_no') {
    await sendBookingText(target(msg), 'No problem — tell me what to change (dates, rooms, location, budget, or hotel).')
    return true
  }

  if (enquiry.status === 'awaiting_budget' || intent === 'new_booking') {
    const budget = extractBudget(msg.text)
    if (budget.budget_amount) {
      enquiry.collected = mergeCollected(enquiry.collected, budget)
      await saveCollected(enquiry, enquiry.collected)
      await sendRecommendations(enquiry, msg, settings)
      return true
    }
  }

  const extracted = extractDetails(msg.text, enquiry.collected)
  if (Object.keys(extracted).length) {
    enquiry.collected = mergeCollected(enquiry.collected, extracted)
    const dateErr =
      enquiry.collected.check_in && enquiry.collected.check_out
        ? validateStayDates(enquiry.collected.check_in, enquiry.collected.check_out)
        : null
    if (dateErr && extracted.check_in) {
      await sendBookingText(target(msg), dateErr)
      enquiry.collected.check_out = undefined
    }
    await saveCollected(enquiry, enquiry.collected)
    await askNext(enquiry, msg, settings)
    return true
  }

  if (enquiry.status === 'collecting_details' && enquiry.last_question) {
    const q = enquiry.last_question
    const t = msg.text.trim()
    if (q === 'customer_name') enquiry.collected.customer_name = t
    else if (q === 'destination') enquiry.collected.destination = t
    else if (q === 'adults') enquiry.collected.adults = Number(t.replace(/\D/g, '')) || enquiry.collected.adults
    else if (q === 'rooms') enquiry.collected.rooms = Number(t.replace(/\D/g, '')) || enquiry.collected.rooms
    else if (q === 'check_in' || q === 'check_out') {
      enquiry.collected = mergeCollected(enquiry.collected, extractDetails(t, enquiry.collected))
    }
    await saveCollected(enquiry, enquiry.collected)
    await askNext(enquiry, msg, settings)
    return true
  }

  await sendBookingText(
    target(msg),
    'I can help with a new booking, hotel options, photos, payment, changes, or cancellation. You can also say *agent* to talk to a person.',
  )
  return true
}

export async function finalizeVerifiedPayment(args: {
  userId: string
  paymentId: string
  actorId?: string
  transactionRef?: string
  receivedAmount?: number
  notes?: string
}): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin()
  const { data: payment } = await db.from('hotel_payments').select('*').eq('id', args.paymentId).single()
  if (!payment || payment.user_id !== args.userId) return { ok: false, error: 'Payment not found' }
  if (payment.status === 'successful') return { ok: false, error: 'Already verified' }

  const expected = Number(payment.expected_amount)
  const received = args.receivedAmount ?? expected
  if (Math.abs(received - expected) > 1) {
    await db
      .from('hotel_payments')
      .update({
        status: 'incorrect_amount',
        received_amount: received,
        transaction_ref: args.transactionRef ?? payment.transaction_ref,
        verification_notes: args.notes ?? 'Amount mismatch',
        verified_by: args.actorId ?? null,
      })
      .eq('id', payment.id)
    return { ok: false, error: 'Amount does not match the required advance' }
  }

  if (args.transactionRef) {
    const { data: dup } = await db
      .from('hotel_payments')
      .select('id')
      .eq('user_id', args.userId)
      .eq('transaction_ref', args.transactionRef)
      .eq('status', 'successful')
      .neq('id', payment.id)
      .maybeSingle()
    if (dup) {
      await db.from('hotel_payments').update({ status: 'duplicate' }).eq('id', payment.id)
      return { ok: false, error: 'This transaction reference was already used' }
    }
  }

  await db
    .from('hotel_payments')
    .update({
      status: 'successful',
      received_amount: received,
      transaction_ref: args.transactionRef ?? payment.transaction_ref,
      verified_at: new Date().toISOString(),
      verified_by: args.actorId ?? null,
      verification_notes: args.notes ?? 'Verified by administrator against payment source',
    })
    .eq('id', payment.id)

  const { data: booking } = await db.from('hotel_bookings').select('*').eq('id', payment.booking_id).single()
  if (!booking) return { ok: false, error: 'Booking missing' }

  const { data: settings } = await db
    .from('hotel_booking_settings')
    .select('*')
    .eq('user_id', args.userId)
    .single()
  const requireHotel = (settings as HotelBookingSettings | null)?.require_hotel_confirmation ?? true
  const next: EnquiryStatus = requireHotel
    ? 'booking_pending_hotel_confirmation'
    : 'booking_confirmed'

  await db.from('hotel_room_holds').update({ status: 'converted' }).eq('booking_id', booking.id).eq('status', 'active')
  await db.from('hotel_bookings').update({
    status: next,
    hotel_confirmed_at: requireHotel ? null : new Date().toISOString(),
  }).eq('id', booking.id)
  if (booking.enquiry_id) {
    await db.from('hotel_enquiries').update({ status: next }).eq('id', booking.enquiry_id)
  }
  await db.from('hotel_status_history').insert({
    user_id: args.userId,
    booking_id: booking.id,
    enquiry_id: booking.enquiry_id,
    from_status: booking.status,
    to_status: next,
    reason: 'Advance payment verified',
    actor: 'admin',
  })

  const { data: hotel } = await db.from('hotels').select('*').eq('id', booking.hotel_id).single()
  const { data: room } = await db.from('hotel_room_types').select('*').eq('id', booking.room_type_id).single()

  if (booking.conversation_id) {
    await sendBookingText(
      {
        userId: args.userId,
        conversationId: booking.conversation_id,
        contactId: booking.contact_id,
      },
      formatConfirmation({
        bookingRef: booking.booking_ref,
        customerName: booking.customer_name ?? '',
        hotelName: hotel?.name ?? '',
        address: hotel?.address,
        hotelPhone: hotel?.contact_phone,
        roomName: room?.name ?? '',
        rooms: booking.rooms,
        guests: `${booking.adults} adult(s)${booking.children ? `, ${booking.children} child(ren)` : ''}`,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        checkInTime: hotel?.check_in_time ?? '14:00',
        checkOutTime: hotel?.check_out_time ?? '11:00',
        nights: booking.nights,
        total: formatMoney(Number(booking.total_amount), booking.currency),
        advance: formatMoney(Number(booking.advance_amount), booking.currency),
        balance: formatMoney(Number(booking.balance_amount), booking.currency),
        status: next === 'booking_confirmed' ? 'Confirmed' : 'Awaiting hotel confirmation',
        policy: booking.cancellation_policy ?? '',
        awaitingHotel: next !== 'booking_confirmed',
      }),
    )
  }

  if (next === 'booking_confirmed' && settings) {
    await scheduleStayReminders({
      userId: args.userId,
      bookingId: booking.id,
      enquiryId: booking.enquiry_id,
      contactId: booking.contact_id,
      conversationId: booking.conversation_id,
      checkIn: booking.check_in,
      settings: settings as HotelBookingSettings,
    })
  }

  await notifyAdmin({
    userId: args.userId,
    title: next === 'booking_confirmed' ? 'Booking confirmed' : 'Payment verified — hotel confirmation pending',
    body: booking.booking_ref,
    eventType: next,
    bookingId: booking.id,
    enquiryId: booking.enquiry_id,
  })
  return { ok: true }
}

export async function confirmHotelReservation(args: {
  userId: string
  bookingId: string
}): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin()
  const { data: booking } = await db.from('hotel_bookings').select('*').eq('id', args.bookingId).single()
  if (!booking || booking.user_id !== args.userId) return { ok: false, error: 'Booking not found' }
  if (booking.status !== 'booking_pending_hotel_confirmation') {
    return { ok: false, error: 'Booking is not waiting for hotel confirmation' }
  }
  await db.from('hotel_bookings').update({
    status: 'booking_confirmed',
    hotel_confirmed_at: new Date().toISOString(),
  }).eq('id', booking.id)
  if (booking.enquiry_id) {
    await db.from('hotel_enquiries').update({ status: 'booking_confirmed' }).eq('id', booking.enquiry_id)
  }
  const { data: settings } = await db.from('hotel_booking_settings').select('*').eq('user_id', args.userId).single()
  const { data: hotel } = await db.from('hotels').select('*').eq('id', booking.hotel_id).single()
  const { data: room } = await db.from('hotel_room_types').select('*').eq('id', booking.room_type_id).single()
  if (booking.conversation_id) {
    await sendBookingText(
      {
        userId: args.userId,
        conversationId: booking.conversation_id,
        contactId: booking.contact_id,
      },
      formatConfirmation({
        bookingRef: booking.booking_ref,
        customerName: booking.customer_name ?? '',
        hotelName: hotel?.name ?? '',
        address: hotel?.address,
        hotelPhone: hotel?.contact_phone,
        roomName: room?.name ?? '',
        rooms: booking.rooms,
        guests: `${booking.adults} adult(s)`,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        checkInTime: hotel?.check_in_time ?? '14:00',
        checkOutTime: hotel?.check_out_time ?? '11:00',
        nights: booking.nights,
        total: formatMoney(Number(booking.total_amount), booking.currency),
        advance: formatMoney(Number(booking.advance_amount), booking.currency),
        balance: formatMoney(Number(booking.balance_amount), booking.currency),
        status: 'Confirmed',
        policy: booking.cancellation_policy ?? '',
      }),
    )
  }
  if (settings) {
    await scheduleStayReminders({
      userId: args.userId,
      bookingId: booking.id,
      enquiryId: booking.enquiry_id,
      contactId: booking.contact_id,
      conversationId: booking.conversation_id,
      checkIn: booking.check_in,
      settings: settings as HotelBookingSettings,
    })
  }
  return { ok: true }
}
