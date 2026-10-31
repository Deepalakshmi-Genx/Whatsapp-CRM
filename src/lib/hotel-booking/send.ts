import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sendImageMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListRow,
} from '@/lib/whatsapp/meta-api'
import {
  isRecipientNotAllowedError,
  isValidE164,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils'

interface Target {
  userId: string
  conversationId: string
  contactId: string
}

async function resolveMeta(target: Target) {
  const db = supabaseAdmin()
  const { data: contact } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', target.contactId)
    .eq('user_id', target.userId)
    .maybeSingle()
  if (!contact?.phone) throw new Error('contact not found')

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) throw new Error('invalid phone')

  const { data: config } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('user_id', target.userId)
    .single()
  if (!config) throw new Error('WhatsApp not configured')

  return {
    db,
    contact,
    sanitized,
    phoneNumberId: config.phone_number_id as string,
    accessToken: decrypt(config.access_token),
  }
}

async function persist(
  db: ReturnType<typeof supabaseAdmin>,
  target: Target,
  args: {
    contentType: 'text' | 'image'
    text: string
    messageId: string
    mediaUrl?: string
  },
) {
  await db.from('messages').insert({
    conversation_id: target.conversationId,
    sender_type: 'bot',
    content_type: args.contentType,
    content_text: args.text,
    media_url: args.mediaUrl ?? null,
    message_id: args.messageId,
    status: 'sent',
  })
  await db
    .from('conversations')
    .update({
      last_message_text: args.text.slice(0, 200),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', target.conversationId)
}

async function withPhoneRetry<T extends { messageId: string }>(
  sanitized: string,
  contactId: string,
  attempt: (phone: string) => Promise<T>,
): Promise<T> {
  const db = supabaseAdmin()
  let lastError: unknown = null
  for (const v of phoneVariants(sanitized)) {
    try {
      const result = await attempt(v)
      if (v !== sanitized) {
        await db.from('contacts').update({ phone: v }).eq('id', contactId)
      }
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  throw lastError ?? new Error('send failed')
}

export async function sendBookingText(target: Target, text: string): Promise<void> {
  const { db, contact, sanitized, phoneNumberId, accessToken } = await resolveMeta(target)
  const result = await withPhoneRetry(sanitized, contact.id, (to) =>
    sendTextMessage({ phoneNumberId, accessToken, to, text }),
  )
  await persist(db, target, { contentType: 'text', text, messageId: result.messageId })
}

export async function sendBookingImage(
  target: Target,
  link: string,
  caption: string,
): Promise<void> {
  const { db, contact, sanitized, phoneNumberId, accessToken } = await resolveMeta(target)
  const result = await withPhoneRetry(sanitized, contact.id, (to) =>
    sendImageMessage({ phoneNumberId, accessToken, to, link, caption }),
  )
  await persist(db, target, {
    contentType: 'image',
    text: caption,
    messageId: result.messageId,
    mediaUrl: link,
  })
}

export async function sendBookingButtons(
  target: Target,
  body: string,
  buttons: InteractiveButton[],
): Promise<void> {
  const { db, contact, sanitized, phoneNumberId, accessToken } = await resolveMeta(target)
  try {
    const result = await withPhoneRetry(sanitized, contact.id, (to) =>
      sendInteractiveButtons({ phoneNumberId, accessToken, to, body, buttons }),
    )
    await persist(db, target, { contentType: 'text', text: body, messageId: result.messageId })
  } catch (err) {
    console.warn('[hotel-booking] interactive buttons failed, falling back to text', err)
    const fallback =
      body +
      '\n\n' +
      buttons.map((b, i) => `${i + 1}) ${b.title}`).join('\n')
    await sendBookingText(target, fallback)
  }
}

export async function sendBookingList(
  target: Target,
  body: string,
  button: string,
  rows: InteractiveListRow[],
): Promise<void> {
  const { db, contact, sanitized, phoneNumberId, accessToken } = await resolveMeta(target)
  try {
    const result = await withPhoneRetry(sanitized, contact.id, (to) =>
      sendInteractiveList({ phoneNumberId, accessToken, to, body, button, rows }),
    )
    await persist(db, target, { contentType: 'text', text: body, messageId: result.messageId })
  } catch (err) {
    console.warn('[hotel-booking] list message failed, falling back to text', err)
    const fallback =
      body +
      '\n\n' +
      rows.map((r, i) => `${i + 1}) ${r.title}${r.description ? ` — ${r.description}` : ''}`).join('\n')
    await sendBookingText(target, fallback)
  }
}

export async function logActivity(args: {
  userId: string
  enquiryId?: string | null
  bookingId?: string | null
  contactId?: string | null
  eventType: string
  detail?: string
  payload?: Record<string, unknown>
}) {
  const db = supabaseAdmin()
  await db.from('hotel_activity_log').insert({
    user_id: args.userId,
    enquiry_id: args.enquiryId ?? null,
    booking_id: args.bookingId ?? null,
    contact_id: args.contactId ?? null,
    event_type: args.eventType,
    detail: args.detail ?? null,
    payload: args.payload ?? {},
  })
}

export async function notifyAdmin(args: {
  userId: string
  title: string
  body: string
  eventType: string
  bookingId?: string | null
  enquiryId?: string | null
}) {
  const db = supabaseAdmin()
  await db.from('hotel_admin_notifications').insert({
    user_id: args.userId,
    title: args.title,
    body: args.body,
    event_type: args.eventType,
    booking_id: args.bookingId ?? null,
    enquiry_id: args.enquiryId ?? null,
  })
}
