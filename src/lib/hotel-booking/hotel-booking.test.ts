import { describe, it, expect } from 'vitest'
import {
  calculateQuote,
  validateStayDates,
  occupancyFits,
  quoteFitsBudget,
} from './pricing'
import { classifyIntent } from './intent'
import { extractTransactionRef } from './payments'
import { canTransition, assertTransition } from './status'
import type { RoomTypeRecord } from './types'

describe('Hotel Booking Pricing Engine', () => {
  const mockRoom: RoomTypeRecord = {
    id: 'room-1',
    hotel_id: 'hotel-1',
    name: 'Deluxe Room',
    description: null,
    max_adults: 2,
    max_children: 2,
    max_occupancy: 3,
    included_adults: 2,
    included_children: 0,
    extra_adult_charge: 500,
    extra_child_charge: 300,
    base_weekday_rate: 2000,
    base_weekend_rate: 2500,
    total_rooms: 5,
    amenities: ['WiFi', 'AC'],
    is_active: true,
  }

  it('validates stay dates correctly', () => {
    expect(validateStayDates('2026-12-01', '2026-12-05')).toBeNull()
    expect(validateStayDates('2026-12-05', '2026-12-01')).toBe('Check-out must be after check-in.')
    expect(validateStayDates('invalid', 'dates')).toContain('Please share dates as DD/MM/YYYY')
  })

  it('enforces room occupancy rules', () => {
    // 1 room: max 2 adults, max 2 children, max 3 total
    expect(occupancyFits(mockRoom, 2, 1, 1)).toBe(true) // 3 total, fits
    expect(occupancyFits(mockRoom, 3, 0, 1)).toBe(false) // 3 adults exceeds max_adults (2)
    expect(occupancyFits(mockRoom, 2, 2, 1)).toBe(false) // 4 guests exceeds max_occupancy (3)
    // 2 rooms: max 4 adults, max 6 total
    expect(occupancyFits(mockRoom, 4, 1, 2)).toBe(true)
  })

  it('calculates 20% advance payment and remaining balance with precision', () => {
    const quote = calculateQuote({
      hotelId: 'hotel-1',
      hotelName: 'Grand Hotel',
      room: mockRoom,
      checkIn: '2026-11-10', // Tue
      checkOut: '2026-11-13', // Fri (3 nights: Tue, Wed, Thu)
      rooms: 1,
      adults: 2,
      children: 0,
      calendar: [],
      seasons: [],
      taxes: [],
      settings: {
        advance_percent: 20,
        currency: 'INR',
        default_tax_percent: 0,
        tax_label: 'GST',
      },
      cancellationPolicy: 'Free cancellation up to 24h',
      inventoryByDate: { '2026-11-10': 5, '2026-11-11': 5, '2026-11-12': 5 },
    })

    // 3 weekday nights * 2000 = 6000
    expect(quote.room_subtotal).toBe(6000)
    expect(quote.total_amount).toBe(6000)
    expect(quote.advance_percent).toBe(20)
    expect(quote.advance_amount).toBe(1200) // 20% of 6000
    expect(quote.balance_amount).toBe(4800) // 80% remaining
    expect(quote.advance_amount + quote.balance_amount).toBe(quote.total_amount)
    expect(quote.availability_ok).toBe(true)
  })

  it('applies seasonal multipliers and extra person charges', () => {
    const quote = calculateQuote({
      hotelId: 'hotel-1',
      hotelName: 'Grand Hotel',
      room: mockRoom,
      checkIn: '2026-11-10',
      checkOut: '2026-11-12', // 2 nights
      rooms: 1,
      adults: 3, // 1 extra adult (included: 2) -> 1 * 500 * 2 nights = 1000
      children: 1, // 1 extra child (included: 0) -> 1 * 300 * 2 nights = 600
      calendar: [],
      seasons: [
        {
          name: 'Peak Season',
          start_date: '2026-11-01',
          end_date: '2026-11-30',
          room_type_id: null,
          rate: null,
          multiplier: 1.5, // 2000 * 1.5 = 3000/night
        },
      ],
      taxes: [{ name: 'GST', percent: 12, fixed_amount: 0, is_active: true }],
      settings: {
        advance_percent: 20,
        currency: 'INR',
        default_tax_percent: 0,
        tax_label: 'GST',
      },
      cancellationPolicy: 'Policy',
      inventoryByDate: { '2026-11-10': 5, '2026-11-11': 5 },
    })

    // 2 nights * 3000 = 6000 room subtotal
    expect(quote.room_subtotal).toBe(6000)
    // extra charges: 1000 (adult) + 600 (child) = 1600
    expect(quote.extra_charges).toBe(1600)
    // taxable: 7600. GST 12%: 912
    expect(quote.tax_amount).toBe(912)
    // total: 7600 + 912 = 8512
    expect(quote.total_amount).toBe(8512)
    // advance: 20% of 8512 = 1702
    expect(quote.advance_amount).toBe(1702)
    expect(quote.balance_amount).toBe(6810)
  })
})

describe('WhatsApp Customer Intent & Multilingual Support (Tamil / Tanglish / English)', () => {
  it('identifies human handover requests', () => {
    expect(classifyIntent('I want to talk to an agent')).toBe('human')
    expect(classifyIntent('can i speak to a human please')).toBe('human')
    expect(classifyIntent('manushan kooda pesa mudiyuma')).toBe('human')
    expect(classifyIntent('call me please')).toBe('human')
  })

  it('identifies cancellation intents', () => {
    expect(classifyIntent('Please cancel my booking')).toBe('cancellation')
    expect(classifyIntent('booking cancel pannunga')).toBe('cancellation')
    expect(classifyIntent('need refund')).toBe('cancellation')
  })

  it('identifies payment confirmation claims', () => {
    expect(classifyIntent('I have paid advance via UPI')).toBe('payment_confirmation')
    expect(classifyIntent('paid UTR: 429182910291')).toBe('payment_confirmation')
    expect(classifyIntent('payment panniten')).toBe('payment_confirmation')
  })

  it('identifies photo and comparison requests', () => {
    expect(classifyIntent('show photos of the room')).toBe('show_photos')
    expect(classifyIntent('padam anupunga')).toBe('show_photos')
    expect(classifyIntent('compare these two hotels')).toBe('compare')
    expect(classifyIntent('any cheaper hotels available?')).toBe('cheaper')
    expect(classifyIntent('kammi budget hotel irukka')).toBe('cheaper')
  })
})

describe('Payment Verification & UTR Extraction', () => {
  it('extracts UTR and transaction references reliably', () => {
    expect(extractTransactionRef('Paid advance. UTR: 429182910291')).toBe('429182910291')
    expect(extractTransactionRef('TXN# UPI1234567890 done')).toBe('UPI1234567890')
    expect(extractTransactionRef('Transaction ID 987654321012 via GPay')).toBe('987654321012')
    expect(extractTransactionRef('Paid just now')).toBeNull()
  })
})

describe('Booking Status State Machine Transitions', () => {
  it('allows valid lifecycle transitions', () => {
    expect(canTransition('new_enquiry', 'collecting_details')).toBe(true)
    expect(canTransition('collecting_details', 'awaiting_budget')).toBe(true)
    expect(canTransition('awaiting_budget', 'showing_hotel_options')).toBe(true)
    expect(canTransition('showing_hotel_options', 'hotel_selected')).toBe(true)
    expect(canTransition('hotel_selected', 'awaiting_customer_confirmation')).toBe(true)
    expect(canTransition('awaiting_customer_confirmation', 'awaiting_advance_payment')).toBe(true)
    expect(canTransition('awaiting_advance_payment', 'payment_verification_pending')).toBe(true)
    expect(canTransition('payment_verification_pending', 'booking_confirmed')).toBe(true)
  })

  it('prohibits invalid jumps or fake instant confirmations', () => {
    expect(canTransition('new_enquiry', 'booking_confirmed')).toBe(false)
    expect(canTransition('showing_hotel_options', 'booking_confirmed')).toBe(false)
    expect(canTransition('awaiting_advance_payment', 'booking_confirmed')).toBe(false)
    expect(() => assertTransition('new_enquiry', 'booking_confirmed')).toThrow()
  })
})

