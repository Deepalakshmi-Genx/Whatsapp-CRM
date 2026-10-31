import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { formatIsoDate } from '@/lib/hotel-booking/money'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = supabaseAdmin()
  const today = formatIsoDate(new Date())

  try {
    const [
      enquiriesRes,
      bookingsRes,
      paymentsRes,
      notificationsRes,
    ] = await Promise.all([
      db
        .from('hotel_enquiries')
        .select('id, status, human_takeover, created_at')
        .eq('user_id', user.id),
      db
        .from('hotel_bookings')
        .select('id, status, check_in, check_out, total_amount, advance_amount, balance_amount')
        .eq('user_id', user.id),
      db
        .from('hotel_payments')
        .select('id, status, kind, expected_amount, received_amount')
        .eq('user_id', user.id),
      db
        .from('hotel_admin_notifications')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    const isMigrationNeeded =
      enquiriesRes.error?.code === 'PGRST205' ||
      bookingsRes.error?.code === 'PGRST205' ||
      paymentsRes.error?.code === 'PGRST205'

    const enquiries = enquiriesRes.data ?? []
    const bookings = bookingsRes.data ?? []
    const payments = paymentsRes.data ?? []

    const totalEnquiries = enquiries.length
    const newEnquiries = enquiries.filter((e) => e.status === 'new_enquiry').length
    const incompleteEnquiries = enquiries.filter((e) =>
      ['collecting_details', 'awaiting_budget'].includes(e.status)
    ).length
    const optionsSent = enquiries.filter((e) => e.status === 'showing_hotel_options').length
    const pendingCustomerConfirmations = enquiries.filter((e) =>
      ['hotel_selected', 'awaiting_customer_confirmation'].includes(e.status)
    ).length
    const activeHumanTakeovers = enquiries.filter((e) => e.human_takeover).length

    const pendingAdvancePayments = bookings.filter((b) => b.status === 'awaiting_advance_payment').length
    const awaitingVerification = bookings.filter((b) => b.status === 'payment_verification_pending').length
    const pendingHotelConfirmations = bookings.filter((b) => b.status === 'booking_pending_hotel_confirmation').length
    const confirmedBookings = bookings.filter((b) => b.status === 'booking_confirmed').length
    const cancelledBookings = bookings.filter((b) => b.status === 'cancelled').length
    const refundsPending = bookings.filter((b) => b.status === 'refund_pending').length

    const upcomingCheckins = bookings.filter(
      (b) => b.status === 'booking_confirmed' && b.check_in >= today
    ).length
    const checkinsToday = bookings.filter(
      (b) => b.status === 'booking_confirmed' && b.check_in === today
    ).length

    let totalRevenue = 0
    let totalAdvanceCollected = 0
    for (const b of bookings) {
      if (b.status === 'booking_confirmed' || b.status === 'completed') {
        totalRevenue += Number(b.total_amount || 0)
      }
    }

    for (const p of payments) {
      if (p.status === 'successful') {
        totalAdvanceCollected += Number(p.received_amount || p.expected_amount || 0)
      }
    }

    return NextResponse.json({
      stats: {
        totalEnquiries,
        newEnquiries,
        incompleteEnquiries,
        optionsSent,
        pendingCustomerConfirmations,
        activeHumanTakeovers,
        pendingAdvancePayments,
        awaitingVerification,
        pendingHotelConfirmations,
        confirmedBookings,
        cancelledBookings,
        refundsPending,
        upcomingCheckins,
        checkinsToday,
        totalRevenue,
        totalAdvanceCollected,
      },
      unreadNotifications: notificationsRes.data ?? [],
      migrationNeeded: isMigrationNeeded,
    })
  } catch {
    return NextResponse.json({
      stats: {
        totalEnquiries: 0,
        newEnquiries: 0,
        incompleteEnquiries: 0,
        optionsSent: 0,
        pendingCustomerConfirmations: 0,
        activeHumanTakeovers: 0,
        pendingAdvancePayments: 0,
        awaitingVerification: 0,
        pendingHotelConfirmations: 0,
        confirmedBookings: 0,
        cancelledBookings: 0,
        refundsPending: 0,
        upcomingCheckins: 0,
        checkinsToday: 0,
        totalRevenue: 0,
        totalAdvanceCollected: 0,
      },
      unreadNotifications: [],
      migrationNeeded: true,
    })
  }
}
