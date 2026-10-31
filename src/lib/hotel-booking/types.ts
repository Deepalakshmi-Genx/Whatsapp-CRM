export const ENQUIRY_STATUSES = [
  'new_enquiry',
  'collecting_details',
  'awaiting_budget',
  'showing_hotel_options',
  'hotel_selected',
  'awaiting_customer_confirmation',
  'awaiting_advance_payment',
  'payment_verification_pending',
  'booking_pending_hotel_confirmation',
  'booking_confirmed',
  'modification_requested',
  'cancellation_requested',
  'cancelled',
  'payment_expired',
  'booking_expired',
  'refund_pending',
  'refund_processed',
  'completed',
] as const

export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number]
export type BookingStatus = EnquiryStatus

export const OPEN_ENQUIRY_STATUSES: EnquiryStatus[] = [
  'new_enquiry',
  'collecting_details',
  'awaiting_budget',
  'showing_hotel_options',
  'hotel_selected',
  'awaiting_customer_confirmation',
  'awaiting_advance_payment',
  'payment_verification_pending',
  'booking_pending_hotel_confirmation',
  'modification_requested',
  'cancellation_requested',
]

export const TERMINAL_STATUSES: EnquiryStatus[] = [
  'cancelled',
  'payment_expired',
  'booking_expired',
  'refund_processed',
  'completed',
]

export type BudgetType = 'total' | 'per_room_night' | 'range'

export type CustomerIntent =
  | 'new_booking'
  | 'existing_booking'
  | 'payment_confirmation'
  | 'cancellation'
  | 'modification'
  | 'show_photos'
  | 'compare'
  | 'cheaper'
  | 'human'
  | 'opt_out'
  | 'greeting'
  | 'affirm'
  | 'deny'
  | 'general'

export interface CollectedDetails {
  customer_name?: string
  contact_number?: string
  destination?: string
  check_in?: string
  check_out?: string
  adults?: number
  children?: number
  child_ages?: number[]
  rooms?: number
  preferred_room_type?: string
  special_requirements?: string
  budget_amount?: number
  budget_type?: BudgetType
  budget_min?: number
  budget_max?: number
  budget_flexible?: boolean
  details_confirmed?: boolean
  recommended_ids?: string[]
  selected_hotel_id?: string
  selected_room_type_id?: string
  photo_index?: number
  last_quote?: PriceQuote
  details_asked?: string[]
}

export interface NightRate {
  date: string
  rate_per_room: number
  source: 'calendar' | 'season' | 'weekend' | 'weekday'
}

export interface PriceQuote {
  hotel_id: string
  hotel_name: string
  room_type_id: string
  room_type_name: string
  check_in: string
  check_out: string
  nights: number
  rooms: number
  adults: number
  children: number
  night_rates: NightRate[]
  room_subtotal: number
  extra_charges: number
  extra_charges_note?: string
  tax_amount: number
  tax_note?: string
  discount_amount: number
  total_amount: number
  currency: string
  advance_percent: number
  advance_amount: number
  balance_amount: number
  cancellation_policy: string
  availability_ok: boolean
  unavailable_dates?: string[]
  estimated: boolean
  /** Present only when recommending alternatives above the stated budget. */
  over_budget_by?: number
}

export interface HotelBookingSettings {
  id: string
  user_id: string
  enabled: boolean
  welcome_message: string
  budget_prompt: string
  advance_percent: number
  currency: string
  payment_deadline_hours: number
  room_hold_hours: number
  require_hotel_confirmation: boolean
  upi_id: string | null
  upi_payee_name: string | null
  upi_qr_image_url: string | null
  payment_instructions: string
  followup_details_hours: number
  followup_budget_hours: number
  followup_options_hours: number
  followup_confirm_hours: number
  followup_payment_hours: number
  max_followups: number
  reminder_days_before_checkin: number
  send_checkin_day_reminder: boolean
  send_post_stay_feedback: boolean
  tax_label: string
  default_tax_percent: number
  supported_languages: string[]
}

export interface HotelRecord {
  id: string
  user_id: string
  name: string
  description: string | null
  short_description: string | null
  destination: string
  address: string | null
  landmark: string | null
  contact_phone: string | null
  contact_email: string | null
  star_rating: number | null
  amenities: string[]
  cancellation_policy: string
  terms: string | null
  check_in_time: string
  check_out_time: string
  min_stay_nights: number
  is_active: boolean
  ranking_boost: number
}

export interface RoomTypeRecord {
  id: string
  hotel_id: string
  name: string
  description: string | null
  max_adults: number
  max_children: number
  max_occupancy: number
  included_adults: number
  included_children: number
  extra_adult_charge: number
  extra_child_charge: number
  base_weekday_rate: number
  base_weekend_rate: number | null
  total_rooms: number
  amenities: string[]
  is_active: boolean
}

export interface RateCalendarRow {
  stay_date: string
  rate: number | null
  available_rooms: number | null
  min_stay_nights: number | null
  is_closed: boolean
}

export interface SeasonalRateRow {
  name: string
  start_date: string
  end_date: string
  room_type_id: string | null
  rate: number | null
  multiplier: number
}

export interface TaxRow {
  name: string
  percent: number
  fixed_amount: number
  is_active: boolean
}

export interface EnquiryRecord {
  id: string
  user_id: string
  contact_id: string
  conversation_id: string | null
  status: EnquiryStatus
  collected: CollectedDetails
  last_question: string | null
  followup_count: number
  human_takeover: boolean
  handover_reason: string | null
  assigned_agent_id: string | null
  internal_notes: string | null
  last_customer_message_at: string | null
  last_bot_message_at: string | null
  last_inbound_message_id: string | null
}

export interface BookingRecord {
  id: string
  user_id: string
  enquiry_id: string | null
  contact_id: string
  conversation_id: string | null
  hotel_id: string
  room_type_id: string
  booking_ref: string
  status: BookingStatus
  customer_name: string | null
  customer_phone: string | null
  destination: string | null
  check_in: string
  check_out: string
  nights: number
  adults: number
  children: number
  child_ages: number[]
  rooms: number
  special_requirements: string | null
  currency: string
  night_rates: NightRate[]
  room_subtotal: number
  extra_charges: number
  tax_amount: number
  discount_amount: number
  total_amount: number
  advance_percent: number
  advance_amount: number
  balance_amount: number
  cancellation_policy: string | null
  hold_expires_at: string | null
  payment_deadline_at: string | null
}
