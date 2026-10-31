import type { CustomerIntent } from './types'

const HUMAN = [
  'agent',
  'human',
  'person',
  'staff',
  'talk to someone',
  'speak to',
  'call me',
  'operator',
  'pesunga',
  'pesa sollu',
  'person kudukka',
  'manager',
  'manushan',
  'pesa',
  'real person',
]

const CANCEL = [
  'cancel',
  'cancellation',
  'cancel pannu',
  'cancel pannunga',
  'booking cancel',
  'raddhu',
  'ரத்து',
  'refund',
  'panam thirumba',
  'money back',
]

const MODIFY = [
  'change',
  'modify',
  'reschedule',
  'update booking',
  'change date',
  'change check-in',
  'one more room',
  'extra room',
  'innoru room',
  'date maathu',
  'date change',
]

const PAYMENT = [
  'i paid',
  'already paid',
  'payment done',
  'paid',
  'upi sent',
  'transaction id',
  'utr',
  'txn',
  'send panniten',
  'pay panniten',
  'payment panniten',
  'screenshot',
  'i have paid',
]

const PHOTOS = ['photo', 'photos', 'picture', 'images', 'gallery', 'padam', 'pic', 'more photos']
const CHEAPER = ['cheaper', 'cheap', 'budget hotel', 'kammi', 'less price', 'lower price', 'sasta']
const COMPARE = ['compare', 'other hotels', 'show more', 'options', 'list', 'innoru hotel']
const AFFIRM = [
  'yes',
  'yeah',
  'yep',
  'ok',
  'okay',
  'confirm',
  'confirmed',
  'sari',
  'seri',
  'correct',
  'proceed',
  'book',
  'go ahead',
  'ஆம்',
  'ama',
  'aam',
]
const DENY = ['no', 'nope', 'wrong', 'change it', 'illa', 'not correct', 'இல்லை']
const OPT_OUT = ['stop', 'unsubscribe', 'dont message', "don't message", 'opt out']
const EXISTING = [
  'my booking',
  'booking status',
  'confirmation',
  'send confirmation',
  'booking number',
  'reference',
]
const GREETING = ['hi', 'hello', 'hey', 'vanakkam', 'வணக்கம்', 'namaste']

function includesAny(text: string, phrases: string[]): boolean {
  return phrases.some((p) => text.includes(p))
}

export function classifyIntent(raw: string, interactiveId?: string): CustomerIntent {
  if (interactiveId) {
    if (interactiveId.startsWith('select_hotel:')) return 'new_booking'
    if (interactiveId.startsWith('select_room:')) return 'new_booking'
    if (interactiveId === 'confirm_yes') return 'affirm'
    if (interactiveId === 'confirm_no') return 'deny'
    if (interactiveId === 'more_photos') return 'show_photos'
    if (interactiveId === 'other_hotels') return 'compare'
    if (interactiveId === 'talk_human') return 'human'
    if (interactiveId === 'cancel_yes') return 'cancellation'
    if (interactiveId === 'cancel_no') return 'deny'
  }

  const text = raw.trim().toLowerCase()
  if (!text) return 'general'
  if (includesAny(text, OPT_OUT)) return 'opt_out'
  if (includesAny(text, HUMAN)) return 'human'
  if (includesAny(text, CANCEL)) return 'cancellation'
  if (includesAny(text, PAYMENT)) return 'payment_confirmation'
  if (includesAny(text, MODIFY)) return 'modification'
  if (includesAny(text, EXISTING)) return 'existing_booking'
  if (includesAny(text, PHOTOS)) return 'show_photos'
  if (includesAny(text, CHEAPER)) return 'cheaper'
  if (includesAny(text, COMPARE)) return 'compare'
  if (GREETING.includes(text) || (text.length <= 12 && includesAny(text, GREETING))) {
    return 'greeting'
  }
  if (AFFIRM.includes(text) || includesAny(text, ['yes book', 'confirm panni'])) return 'affirm'
  if (DENY.includes(text)) return 'deny'
  return 'new_booking'
}
