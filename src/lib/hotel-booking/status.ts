import type { EnquiryStatus } from './types'

const ALLOWED: Record<EnquiryStatus, EnquiryStatus[]> = {
  new_enquiry: ['collecting_details', 'cancelled'],
  collecting_details: ['awaiting_budget', 'collecting_details', 'cancelled'],
  awaiting_budget: ['showing_hotel_options', 'collecting_details', 'cancelled'],
  showing_hotel_options: [
    'hotel_selected',
    'awaiting_budget',
    'collecting_details',
    'cancelled',
  ],
  hotel_selected: [
    'awaiting_customer_confirmation',
    'showing_hotel_options',
    'collecting_details',
    'cancelled',
  ],
  awaiting_customer_confirmation: [
    'awaiting_advance_payment',
    'hotel_selected',
    'showing_hotel_options',
    'collecting_details',
    'cancelled',
  ],
  awaiting_advance_payment: [
    'payment_verification_pending',
    'payment_expired',
    'cancellation_requested',
    'modification_requested',
    'cancelled',
  ],
  payment_verification_pending: [
    'booking_pending_hotel_confirmation',
    'booking_confirmed',
    'awaiting_advance_payment',
    'cancelled',
    'refund_pending',
  ],
  booking_pending_hotel_confirmation: [
    'booking_confirmed',
    'cancelled',
    'refund_pending',
    'modification_requested',
  ],
  booking_confirmed: [
    'completed',
    'cancellation_requested',
    'modification_requested',
    'cancelled',
  ],
  modification_requested: [
    'awaiting_customer_confirmation',
    'awaiting_advance_payment',
    'booking_confirmed',
    'cancelled',
  ],
  cancellation_requested: ['cancelled', 'refund_pending', 'booking_confirmed'],
  cancelled: ['refund_pending', 'refund_processed'],
  payment_expired: ['awaiting_advance_payment', 'cancelled', 'booking_expired'],
  booking_expired: [],
  refund_pending: ['refund_processed', 'cancelled'],
  refund_processed: [],
  completed: [],
}

export function canTransition(from: EnquiryStatus, to: EnquiryStatus): boolean {
  if (from === to) return true
  return (ALLOWED[from] ?? []).includes(to)
}

export function assertTransition(from: EnquiryStatus, to: EnquiryStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid booking status transition: ${from} → ${to}`)
  }
}
