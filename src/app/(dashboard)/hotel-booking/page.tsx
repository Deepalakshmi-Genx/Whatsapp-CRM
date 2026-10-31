"use client"

import { useEffect, useState, useCallback } from "react"
import { toast } from "sonner"
import {
  Hotel,
  Calendar,
  CreditCard,
  UserCheck,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Search,
  Plus,
  ShieldAlert,
  Send,
  Building,
  DollarSign,
  TrendingUp,
  XCircle,
  Eye,
  Sliders,
  Check,
  Phone,
  MapPin,
  Users,
  Bed,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface Stats {
  totalEnquiries: number
  newEnquiries: number
  incompleteEnquiries: number
  optionsSent: number
  pendingCustomerConfirmations: number
  activeHumanTakeovers: number
  pendingAdvancePayments: number
  awaitingVerification: number
  pendingHotelConfirmations: number
  confirmedBookings: number
  cancelledBookings: number
  refundsPending: number
  upcomingCheckins: number
  checkinsToday: number
  totalRevenue: number
  totalAdvanceCollected: number
}

interface Enquiry {
  id: string
  status: string
  collected: Record<string, any>
  human_takeover: boolean
  handover_reason: string | null
  internal_notes: string | null
  last_customer_message_at: string | null
  contacts: { id: string; name?: string; phone: string } | null
}

interface Booking {
  id: string
  booking_ref: string
  status: string
  customer_name: string | null
  customer_phone: string | null
  check_in: string
  check_out: string
  nights: number
  rooms: number
  adults: number
  children: number
  total_amount: number
  advance_amount: number
  balance_amount: number
  currency: string
  hotels: { name: string; destination: string; address?: string } | null
  hotel_room_types: { name: string; base_weekday_rate: number } | null
  cancellation_policy?: string
  night_rates?: Array<{ date: string; rate_per_room: number; source: string }>
}

interface Payment {
  id: string
  booking_id: string
  kind: string
  expected_amount: number
  received_amount: number | null
  currency: string
  status: string
  upi_id: string | null
  transaction_ref: string | null
  customer_note: string | null
  created_at: string
  hotel_bookings: {
    booking_ref: string
    customer_name: string | null
    customer_phone: string | null
    total_amount: number
    advance_amount: number
    hotels: { name: string } | null
  } | null
}

interface HotelRecord {
  id: string
  name: string
  destination: string
  address: string | null
  contact_phone: string | null
  star_rating: number | null
  is_active: boolean
  hotel_room_types: Array<{
    id: string
    name: string
    base_weekday_rate: number
    base_weekend_rate: number | null
    total_rooms: number
    max_occupancy: number
  }>
  hotel_photos: Array<{
    id: string
    image_url: string
    category: string
    caption: string | null
  }>
}

export default function HotelBookingDashboard() {
  const [activeTab, setActiveTab] = useState("overview")
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<Stats | null>(null)
  const [notifications, setNotifications] = useState<any[]>([])
  const [migrationNeeded, setMigrationNeeded] = useState(false)

  // Enquiries State
  const [enquiries, setEnquiries] = useState<Enquiry[]>([])
  const [enquiryFilter, setEnquiryFilter] = useState("all")
  const [enquirySearch, setEnquirySearch] = useState("")

  // Bookings State
  const [bookings, setBookings] = useState<Booking[]>([])
  const [bookingFilter, setBookingFilter] = useState("all")
  const [bookingSearch, setBookingSearch] = useState("")
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)

  // Payments State
  const [payments, setPayments] = useState<Payment[]>([])
  const [paymentFilter, setPaymentFilter] = useState("all")
  const [verifyingPayment, setVerifyingPayment] = useState<Payment | null>(null)
  const [verifyUtr, setVerifyUtr] = useState("")
  const [verifyAmount, setVerifyAmount] = useState("")
  const [verifyNotes, setVerifyNotes] = useState("")

  // Hotels State
  const [hotels, setHotels] = useState<HotelRecord[]>([])
  const [hotelModalOpen, setHotelModalOpen] = useState(false)
  const [newHotel, setNewHotel] = useState({
    name: "",
    destination: "",
    address: "",
    contact_phone: "",
    star_rating: 4,
    weekday_rate: 2500,
    weekend_rate: 3000,
    total_rooms: 5,
    room_name: "Deluxe King Room",
    photo_url: "https://images.unsplash.com/photo-1566073771259-6a8506099945",
  })

  // Settings State
  const [settings, setSettings] = useState<any>(null)
  const [savingSettings, setSavingSettings] = useState(false)

  // Cron / Process Trigger
  const [runningCron, setRunningCron] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/hotel-booking/stats")
      const data = await res.json()
      if (data.stats) setStats(data.stats)
      if (data.unreadNotifications) setNotifications(data.unreadNotifications)
      if (data.migrationNeeded) setMigrationNeeded(true)
    } catch {
      // ignore
    }
  }, [])

  const fetchEnquiries = useCallback(async () => {
    try {
      const res = await fetch(`/api/hotel-booking/enquiries?status=${enquiryFilter}&search=${encodeURIComponent(enquirySearch)}`)
      const data = await res.json()
      if (data.enquiries) setEnquiries(data.enquiries)
      if (data.migrationNeeded) setMigrationNeeded(true)
    } catch {
      // ignore
    }
  }, [enquiryFilter, enquirySearch])

  const fetchBookings = useCallback(async () => {
    try {
      const res = await fetch(`/api/hotel-booking/bookings?status=${bookingFilter}&search=${encodeURIComponent(bookingSearch)}`)
      const data = await res.json()
      if (data.bookings) setBookings(data.bookings)
      if (data.migrationNeeded) setMigrationNeeded(true)
    } catch {
      // ignore
    }
  }, [bookingFilter, bookingSearch])

  const fetchPayments = useCallback(async () => {
    try {
      const res = await fetch(`/api/hotel-booking/payments?status=${paymentFilter}`)
      const data = await res.json()
      if (data.payments) setPayments(data.payments)
      if (data.migrationNeeded) setMigrationNeeded(true)
    } catch {
      // ignore
    }
  }, [paymentFilter])

  const fetchHotels = useCallback(async () => {
    try {
      const res = await fetch("/api/hotel-booking/hotels")
      const data = await res.json()
      if (data.hotels) setHotels(data.hotels)
    } catch {
      // ignore
    }
  }, [])

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/hotel-booking/settings")
      const data = await res.json()
      if (data.settings) setSettings(data.settings)
      if (data.migrationNeeded) setMigrationNeeded(true)
    } catch {
      // ignore
    }
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([
      fetchStats(),
      fetchEnquiries(),
      fetchBookings(),
      fetchPayments(),
      fetchHotels(),
      fetchSettings(),
    ])
    setLoading(false)
  }, [fetchStats, fetchEnquiries, fetchBookings, fetchPayments, fetchHotels, fetchSettings])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  const handleRunCron = async () => {
    setRunningCron(true)
    try {
      const res = await fetch("/api/hotel-booking/cron", { method: "POST" })
      const data = await res.json()
      if (data.success) {
        toast.success(
          `Scheduler executed: ${data.scheduled_messages_sent} reminders sent, ${data.expired_holds_and_payments} holds expired.`
        )
        refreshAll()
      } else {
        toast.error(data.error || "Failed to run scheduler")
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setRunningCron(false)
    }
  }

  const handleToggleTakeover = async (enquiry: Enquiry) => {
    const next = !enquiry.human_takeover
    try {
      const res = await fetch("/api/hotel-booking/enquiries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: enquiry.id,
          human_takeover: next,
          handover_reason: next ? "Manual agent takeover from dashboard" : null,
        }),
      })
      const data = await res.json()
      if (data.enquiry) {
        toast.success(next ? "Bot muted: Human takeover active" : "Bot resumed: Automation active")
        fetchEnquiries()
      }
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleVerifyPayment = async () => {
    if (!verifyingPayment) return
    try {
      const res = await fetch("/api/hotel-booking/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId: verifyingPayment.id,
          transactionRef: verifyUtr || undefined,
          receivedAmount: verifyAmount ? Number(verifyAmount) : undefined,
          notes: verifyNotes || undefined,
        }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        setVerifyingPayment(null)
        setVerifyUtr("")
        setVerifyAmount("")
        setVerifyNotes("")
        refreshAll()
      } else {
        toast.error(data.error || "Verification failed")
      }
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleConfirmHotel = async (bookingId: string) => {
    try {
      const res = await fetch(`/api/hotel-booking/bookings/${bookingId}/confirm`, {
        method: "POST",
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        setSelectedBooking(null)
        refreshAll()
      } else {
        toast.error(data.error || "Confirmation failed")
      }
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleSaveSettings = async () => {
    if (!settings) return
    setSavingSettings(true)
    try {
      const res = await fetch("/api/hotel-booking/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (data.settings) {
        setSettings(data.settings)
        toast.success("Hotel booking settings saved successfully")
      } else {
        toast.error(data.error || "Failed to save settings")
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSavingSettings(false)
    }
  }

  const handleCreateHotel = async () => {
    if (!newHotel.name || !newHotel.destination) {
      toast.error("Please provide hotel name and destination")
      return
    }
    try {
      const res = await fetch("/api/hotel-booking/hotels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newHotel.name,
          destination: newHotel.destination,
          address: newHotel.address,
          contact_phone: newHotel.contact_phone,
          star_rating: newHotel.star_rating,
          room_types: [
            {
              name: newHotel.room_name,
              base_weekday_rate: Number(newHotel.weekday_rate),
              base_weekend_rate: Number(newHotel.weekend_rate),
              total_rooms: Number(newHotel.total_rooms),
              max_occupancy: 3,
              included_adults: 2,
            },
          ],
          photos: [
            {
              image_url: newHotel.photo_url,
              category: "exterior",
              caption: "Property Exterior",
            },
          ],
        }),
      })
      const data = await res.json()
      if (data.hotel) {
        toast.success("Hotel created with room type & photo!")
        setHotelModalOpen(false)
        fetchHotels()
      } else {
        toast.error(data.error || "Failed to create hotel")
      }
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "booking_confirmed":
        return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Confirmed</Badge>
      case "booking_pending_hotel_confirmation":
        return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20">Awaiting Hotel Confirmation</Badge>
      case "payment_verification_pending":
        return <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20">Awaiting Payment Verification</Badge>
      case "awaiting_advance_payment":
        return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">Awaiting 20% Advance</Badge>
      case "showing_hotel_options":
        return <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20">Options Sent</Badge>
      case "cancelled":
        return <Badge className="bg-red-500/10 text-red-400 border-red-500/20">Cancelled</Badge>
      case "successful":
        return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Verified</Badge>
      default:
        return <Badge variant="outline" className="border-slate-700 text-slate-300">{status.replace(/_/g, " ")}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/20">
              <Hotel className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-100">
                WhatsApp Hotel Booking Automation
              </h1>
              <p className="text-sm text-slate-400">
                Real-time booking pipeline, date-wise pricing, UPI payments & automated follow-ups
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunCron}
            disabled={runningCron}
            className="border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${runningCron ? "animate-spin text-violet-400" : ""}`} />
            Run Scheduler & Expiry
          </Button>

          <Button
            size="sm"
            onClick={() => setHotelModalOpen(true)}
            className="bg-violet-600 text-white hover:bg-violet-500"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Hotel
          </Button>
        </div>
      </div>

      {/* Migration Notice */}
      {migrationNeeded && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h4 className="font-semibold text-amber-300">Database Setup Required (Supabase Migration 010)</h4>
              <p className="text-sm text-amber-200/90 leading-relaxed">
                The Hotel Booking tables have not been created in your Supabase database yet.
                To activate live bookings, open your <strong>Supabase Dashboard → SQL Editor</strong>, paste and run the SQL code from:
              </p>
              <div className="mt-2 font-mono text-xs bg-slate-950/80 p-2.5 rounded border border-amber-500/20 text-slate-300 select-all">
                supabase/migrations/010_hotel_booking.sql
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-slate-900 border border-slate-800 p-1">
          <TabsTrigger value="overview" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white">
            Overview
          </TabsTrigger>
          <TabsTrigger value="enquiries" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white">
            Enquiries ({stats?.totalEnquiries ?? 0})
          </TabsTrigger>
          <TabsTrigger value="bookings" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white">
            Bookings ({stats?.confirmedBookings ?? 0})
          </TabsTrigger>
          <TabsTrigger value="payments" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white">
            Payments ({stats?.awaitingVerification ? `! ${stats.awaitingVerification}` : stats?.pendingAdvancePayments ?? 0})
          </TabsTrigger>
          <TabsTrigger value="hotels" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white">
            Hotels & Inventory ({hotels.length})
          </TabsTrigger>
          <TabsTrigger value="settings" className="data-[state=active]:bg-violet-600 data-[state=active]:text-white">
            Settings
          </TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-slate-900/60 border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Total Enquiries</CardTitle>
                <Users className="h-4 w-4 text-violet-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-100">{stats?.totalEnquiries ?? 0}</div>
                <p className="text-xs text-slate-500 mt-1">
                  {stats?.newEnquiries ?? 0} new, {stats?.incompleteEnquiries ?? 0} in progress
                </p>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/60 border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Advance Pending</CardTitle>
                <Clock className="h-4 w-4 text-amber-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-100">{stats?.pendingAdvancePayments ?? 0}</div>
                <p className="text-xs text-amber-400/80 mt-1">
                  20% advance hold expires in 6 hrs
                </p>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/60 border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Payment Verification</CardTitle>
                <ShieldAlert className="h-4 w-4 text-purple-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-400">{stats?.awaitingVerification ?? 0}</div>
                <p className="text-xs text-slate-500 mt-1">
                  Customer reported UTR to verify
                </p>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/60 border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Confirmed Bookings</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-400">{stats?.confirmedBookings ?? 0}</div>
                <p className="text-xs text-slate-500 mt-1">
                  {stats?.checkinsToday ?? 0} checking in today
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="bg-slate-900/60 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  Financial Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-slate-800">
                  <span className="text-sm text-slate-400">Total Confirmed Booking Value</span>
                  <span className="text-lg font-bold text-slate-100">₹{(stats?.totalRevenue ?? 0).toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-800">
                  <span className="text-sm text-slate-400">Verified Advance Received (20%)</span>
                  <span className="text-lg font-bold text-emerald-400">₹{(stats?.totalAdvanceCollected ?? 0).toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-slate-400">Balance Receivable At Check-in</span>
                  <span className="text-lg font-bold text-slate-300">
                    ₹{((stats?.totalRevenue ?? 0) - (stats?.totalAdvanceCollected ?? 0)).toLocaleString("en-IN")}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/60 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-violet-400" />
                  Action Alerts
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Events requiring your immediate attention
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {stats?.awaitingVerification ? (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                    <div className="flex items-center gap-3">
                      <CreditCard className="h-5 w-5 text-purple-400" />
                      <div>
                        <p className="text-sm font-medium text-slate-200">{stats.awaitingVerification} Payment(s) Waiting Verification</p>
                        <p className="text-xs text-slate-400">Customers submitted UTRs</p>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setActiveTab("payments")} className="bg-purple-600 hover:bg-purple-500">
                      Verify Now
                    </Button>
                  </div>
                ) : null}

                {stats?.pendingHotelConfirmations ? (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-center gap-3">
                      <Hotel className="h-5 w-5 text-amber-400" />
                      <div>
                        <p className="text-sm font-medium text-slate-200">{stats.pendingHotelConfirmations} Awaiting Hotel Confirmation</p>
                        <p className="text-xs text-slate-400">Advance verified, needs hotel confirmation</p>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setActiveTab("bookings")} variant="outline" className="border-amber-500/30 text-amber-300">
                      View Bookings
                    </Button>
                  </div>
                ) : null}

                {stats?.activeHumanTakeovers ? (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <div className="flex items-center gap-3">
                      <UserCheck className="h-5 w-5 text-blue-400" />
                      <div>
                        <p className="text-sm font-medium text-slate-200">{stats.activeHumanTakeovers} Human Takeover(s) Active</p>
                        <p className="text-xs text-slate-400">Bot is muted; human agent talking</p>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setActiveTab("enquiries")} variant="outline" className="border-blue-500/30 text-blue-300">
                      Manage
                    </Button>
                  </div>
                ) : null}

                {!stats?.awaitingVerification && !stats?.pendingHotelConfirmations && !stats?.activeHumanTakeovers && (
                  <p className="text-sm text-slate-500 text-center py-4">
                    All caught up! The automated bot is handling incoming chats smoothly.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ENQUIRIES TAB */}
        <TabsContent value="enquiries" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search by customer, phone, location..."
                value={enquirySearch}
                onChange={(e) => setEnquirySearch(e.target.value)}
                className="pl-9 bg-slate-900 border-slate-800 text-slate-200"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto overflow-x-auto">
              {["all", "new_enquiry", "collecting_details", "awaiting_budget", "showing_hotel_options", "hotel_selected"].map((s) => (
                <Button
                  key={s}
                  variant={enquiryFilter === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEnquiryFilter(s)}
                  className={enquiryFilter === s ? "bg-violet-600" : "border-slate-800 bg-slate-900 text-slate-400"}
                >
                  {s.replace(/_/g, " ")}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {enquiries.length === 0 ? (
              <Card className="bg-slate-900/40 border-slate-800 p-8 text-center text-slate-400">
                No customer enquiries found matching filter.
              </Card>
            ) : (
              enquiries.map((enq) => {
                const c = enq.collected || {}
                return (
                  <Card key={enq.id} className="bg-slate-900/60 border-slate-800 hover:border-slate-700 transition">
                    <CardContent className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-slate-200">
                            {c.customer_name || enq.contacts?.name || "Customer"}
                          </span>
                          <span className="text-xs text-slate-400 flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {c.contact_number || enq.contacts?.phone}
                          </span>
                          {statusBadge(enq.status)}
                          {enq.human_takeover && (
                            <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/20">Agent Takeover</Badge>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 pt-1">
                          {c.destination && <span>📍 {c.destination}</span>}
                          {c.check_in && c.check_out && <span>📅 {c.check_in} → {c.check_out}</span>}
                          {c.rooms && <span>🚪 {c.rooms} Room(s)</span>}
                          {c.adults && <span>👥 {c.adults} Adults {c.children ? `, ${c.children} Children` : ""}</span>}
                          {c.budget_amount && <span>💰 Budget: ₹{c.budget_amount} ({c.budget_type || "total"})</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleToggleTakeover(enq)}
                          className={enq.human_takeover ? "border-rose-500/40 text-rose-300" : "border-slate-800 text-slate-300"}
                        >
                          <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                          {enq.human_takeover ? "Resume Bot" : "Take Over"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        </TabsContent>

        {/* BOOKINGS TAB */}
        <TabsContent value="bookings" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search booking ref, customer, hotel..."
                value={bookingSearch}
                onChange={(e) => setBookingSearch(e.target.value)}
                className="pl-9 bg-slate-900 border-slate-800 text-slate-200"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto overflow-x-auto">
              {["all", "awaiting_advance_payment", "payment_verification_pending", "booking_pending_hotel_confirmation", "booking_confirmed", "cancelled"].map((s) => (
                <Button
                  key={s}
                  variant={bookingFilter === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => setBookingFilter(s)}
                  className={bookingFilter === s ? "bg-violet-600" : "border-slate-800 bg-slate-900 text-slate-400"}
                >
                  {s.replace(/_/g, " ")}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {bookings.length === 0 ? (
              <Card className="bg-slate-900/40 border-slate-800 p-8 text-center text-slate-400">
                No bookings found matching filter.
              </Card>
            ) : (
              bookings.map((b) => (
                <Card key={b.id} className="bg-slate-900/60 border-slate-800 hover:border-slate-700 transition">
                  <CardContent className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-violet-400 text-sm">
                          {b.booking_ref}
                        </span>
                        <span className="font-semibold text-slate-200">
                          {b.customer_name || "Guest"}
                        </span>
                        {statusBadge(b.status)}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 pt-1">
                        <span>🏨 {b.hotels?.name} ({b.hotel_room_types?.name})</span>
                        <span>📅 {b.check_in} → {b.check_out} ({b.nights} nights)</span>
                        <span>👥 {b.rooms} Room(s), {b.adults} Adults</span>
                      </div>

                      <div className="flex gap-4 text-xs pt-1">
                        <span className="text-slate-300">Total: <strong>₹{Number(b.total_amount).toLocaleString("en-IN")}</strong></span>
                        <span className="text-emerald-400">20% Advance: <strong>₹{Number(b.advance_amount).toLocaleString("en-IN")}</strong></span>
                        <span className="text-amber-400">Balance: <strong>₹{Number(b.balance_amount).toLocaleString("en-IN")}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {b.status === "booking_pending_hotel_confirmation" && (
                        <Button
                          size="sm"
                          onClick={() => handleConfirmHotel(b.id)}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white"
                        >
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                          Confirm Hotel
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedBooking(b)}
                        className="border-slate-800 text-slate-300 hover:bg-slate-800"
                      >
                        <Eye className="mr-1.5 h-3.5 w-3.5" />
                        Details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* PAYMENTS TAB */}
        <TabsContent value="payments" className="space-y-4">
          <div className="flex gap-2 overflow-x-auto">
            {["all", "verification_pending", "initiated", "successful", "expired"].map((s) => (
              <Button
                key={s}
                variant={paymentFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setPaymentFilter(s)}
                className={paymentFilter === s ? "bg-violet-600" : "border-slate-800 bg-slate-900 text-slate-400"}
              >
                {s.replace(/_/g, " ")}
              </Button>
            ))}
          </div>

          <div className="space-y-3">
            {payments.length === 0 ? (
              <Card className="bg-slate-900/40 border-slate-800 p-8 text-center text-slate-400">
                No payment transactions found.
              </Card>
            ) : (
              payments.map((p) => (
                <Card key={p.id} className="bg-slate-900/60 border-slate-800">
                  <CardContent className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-slate-400">
                          Ref: {p.hotel_bookings?.booking_ref || "N/A"}
                        </span>
                        <span className="font-semibold text-slate-200">
                          {p.hotel_bookings?.customer_name || "Customer"}
                        </span>
                        {statusBadge(p.status)}
                      </div>

                      <div className="flex gap-4 text-xs text-slate-400 pt-1">
                        <span>Expected Advance: <strong className="text-slate-200">₹{p.expected_amount}</strong></span>
                        {p.received_amount && <span>Received: <strong className="text-emerald-400">₹{p.received_amount}</strong></span>}
                        {p.transaction_ref && <span>UTR: <strong className="font-mono text-purple-300">{p.transaction_ref}</strong></span>}
                      </div>

                      {p.customer_note && (
                        <p className="text-xs text-slate-400 italic bg-slate-950/60 p-1.5 rounded mt-1">
                          Note: &ldquo;{p.customer_note}&rdquo;
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {p.status !== "successful" && p.status !== "expired" && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setVerifyingPayment(p)
                            setVerifyUtr(p.transaction_ref || "")
                            setVerifyAmount(String(p.expected_amount))
                          }}
                          className="bg-purple-600 hover:bg-purple-500 text-white"
                        >
                          <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                          Verify & Confirm
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* HOTELS TAB */}
        <TabsContent value="hotels" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {hotels.map((h) => (
              <Card key={h.id} className="bg-slate-900/60 border-slate-800 overflow-hidden flex flex-col justify-between">
                <div>
                  {h.hotel_photos?.[0] ? (
                    <div className="h-44 w-full overflow-hidden bg-slate-950 relative">
                      <img
                        src={h.hotel_photos[0].image_url}
                        alt={h.name}
                        className="h-full w-full object-cover"
                      />
                      <Badge className="absolute top-2 right-2 bg-slate-950/80 text-amber-300 border-none">
                        ⭐ {h.star_rating || 4} Stars
                      </Badge>
                    </div>
                  ) : (
                    <div className="h-44 w-full bg-slate-950 flex items-center justify-center text-slate-600">
                      <Hotel className="h-12 w-12" />
                    </div>
                  )}

                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-lg text-slate-100">{h.name}</CardTitle>
                    <CardDescription className="text-slate-400 flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" /> {h.destination} {h.address ? `• ${h.address}` : ""}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-4 pt-0 space-y-2">
                    <div className="text-xs text-slate-400 space-y-1">
                      <p className="font-semibold text-slate-300">Room Types:</p>
                      {h.hotel_room_types?.map((rt) => (
                        <div key={rt.id} className="flex justify-between items-center py-1 border-b border-slate-800/60">
                          <span>{rt.name} ({rt.total_rooms} rooms)</span>
                          <span className="text-violet-400 font-semibold">₹{rt.base_weekday_rate}/nt</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* SETTINGS TAB */}
        <TabsContent value="settings" className="space-y-6">
          {settings && (
            <Card className="bg-slate-900/60 border-slate-800">
              <CardHeader>
                <CardTitle className="text-slate-100 flex items-center gap-2">
                  <Sliders className="h-5 w-5 text-violet-400" />
                  Hotel Booking Business Rules & Configurations
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Customizable pricing rules, advance percentage, UPI credentials, and follow-up intervals
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-slate-200">Enable Automated WhatsApp Hotel Booking</p>
                    <p className="text-xs text-slate-400">
                      When enabled, inbound customer messages route to the hotel booking agent flow
                    </p>
                  </div>
                  <Switch
                    checked={settings.enabled}
                    onCheckedChange={(val) => setSettings({ ...settings, enabled: val })}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Advance Payment Percentage</label>
                    <Input
                      type="number"
                      value={settings.advance_percent}
                      onChange={(e) => setSettings({ ...settings, advance_percent: Number(e.target.value) })}
                      className="bg-slate-950 border-slate-800 text-slate-200"
                    />
                    <p className="text-xs text-slate-500">Default: 20%. Customer pays this advance to secure booking.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Room Hold Expiration (Hours)</label>
                    <Input
                      type="number"
                      value={settings.room_hold_hours}
                      onChange={(e) => setSettings({ ...settings, room_hold_hours: Number(e.target.value) })}
                      className="bg-slate-950 border-slate-800 text-slate-200"
                    />
                    <p className="text-xs text-slate-500">Unpaid rooms are released automatically after this window.</p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Business UPI ID</label>
                    <Input
                      value={settings.upi_id || ""}
                      placeholder="business@upi"
                      onChange={(e) => setSettings({ ...settings, upi_id: e.target.value })}
                      className="bg-slate-950 border-slate-800 text-slate-200"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">UPI Payee Name</label>
                    <Input
                      value={settings.upi_payee_name || ""}
                      placeholder="My Hotel Services"
                      onChange={(e) => setSettings({ ...settings, upi_payee_name: e.target.value })}
                      className="bg-slate-950 border-slate-800 text-slate-200"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Custom Welcome Message</label>
                  <Textarea
                    rows={4}
                    value={settings.welcome_message || ""}
                    onChange={(e) => setSettings({ ...settings, welcome_message: e.target.value })}
                    className="bg-slate-950 border-slate-800 text-slate-200"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Budget Prompt Message</label>
                  <Textarea
                    rows={3}
                    value={settings.budget_prompt || ""}
                    onChange={(e) => setSettings({ ...settings, budget_prompt: e.target.value })}
                    className="bg-slate-950 border-slate-800 text-slate-200"
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveSettings}
                    disabled={savingSettings}
                    className="bg-violet-600 hover:bg-violet-500 text-white"
                  >
                    {savingSettings ? "Saving..." : "Save Settings"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* VERIFY PAYMENT DIALOG */}
      <Dialog open={!!verifyingPayment} onOpenChange={() => setVerifyingPayment(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-purple-400" />
              Verify 20% Advance Payment
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Verify this transaction against your bank or UPI gateway before confirming the room.
            </DialogDescription>
          </DialogHeader>

          {verifyingPayment && (
            <div className="space-y-4 py-2">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-sm space-y-1">
                <p>Booking Ref: <strong>{verifyingPayment.hotel_bookings?.booking_ref}</strong></p>
                <p>Customer: <strong>{verifyingPayment.hotel_bookings?.customer_name}</strong> ({verifyingPayment.hotel_bookings?.customer_phone})</p>
                <p>Required Advance (20%): <strong className="text-emerald-400">₹{verifyingPayment.expected_amount}</strong></p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Bank / UPI UTR Reference Number</label>
                <Input
                  value={verifyUtr}
                  onChange={(e) => setVerifyUtr(e.target.value)}
                  placeholder="e.g. 429182910291"
                  className="bg-slate-950 border-slate-800 text-slate-200"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Verified Amount Received (₹)</label>
                <Input
                  type="number"
                  value={verifyAmount}
                  onChange={(e) => setVerifyAmount(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-slate-200"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Verification Notes</label>
                <Input
                  value={verifyNotes}
                  onChange={(e) => setVerifyNotes(e.target.value)}
                  placeholder="Verified via HDFC Bank / PhonePe UPI statement"
                  className="bg-slate-950 border-slate-800 text-slate-200"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyingPayment(null)} className="border-slate-800 text-slate-300">
              Cancel
            </Button>
            <Button onClick={handleVerifyPayment} className="bg-purple-600 hover:bg-purple-500 text-white">
              Confirm & Issue Booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BOOKING DETAILS DIALOG */}
      <Dialog open={!!selectedBooking} onOpenChange={() => setSelectedBooking(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-lg">
          <DialogHeader>
            <DialogTitle>Booking Details — {selectedBooking?.booking_ref}</DialogTitle>
          </DialogHeader>

          {selectedBooking && (
            <div className="space-y-3 py-2 text-sm">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                <p>Hotel: <strong>{selectedBooking.hotels?.name}</strong></p>
                <p>Room Type: <strong>{selectedBooking.hotel_room_types?.name}</strong></p>
                <p>Stay: <strong>{selectedBooking.check_in} → {selectedBooking.check_out}</strong> ({selectedBooking.nights} nights)</p>
                <p>Occupancy: <strong>{selectedBooking.rooms} room(s), {selectedBooking.adults} adults{selectedBooking.children ? `, ${selectedBooking.children} children` : ""}</strong></p>
              </div>

              <div className="space-y-1 bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Price:</span>
                  <span className="font-bold text-slate-100">₹{selectedBooking.total_amount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">20% Advance Paid:</span>
                  <span className="font-bold text-emerald-400">₹{selectedBooking.advance_amount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Remaining Balance:</span>
                  <span className="font-bold text-amber-400">₹{selectedBooking.balance_amount}</span>
                </div>
              </div>

              {selectedBooking.night_rates && selectedBooking.night_rates.length > 0 && (
                <div>
                  <p className="font-semibold text-xs text-slate-400 mb-1">Night-by-night breakdown:</p>
                  <div className="space-y-1 text-xs bg-slate-950 p-2 rounded border border-slate-800">
                    {selectedBooking.night_rates.map((nr) => (
                      <div key={nr.date} className="flex justify-between">
                        <span>{nr.date} ({nr.source})</span>
                        <span className="text-violet-300">₹{nr.rate_per_room}/room</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setSelectedBooking(null)} className="bg-slate-800 text-slate-200">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADD HOTEL DIALOG */}
      <Dialog open={hotelModalOpen} onOpenChange={setHotelModalOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Hotel & Inventory</DialogTitle>
            <DialogDescription className="text-slate-400">
              Create a hotel property with rooms, pricing, and photographs for automated booking
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Hotel Name</label>
                <Input
                  value={newHotel.name}
                  onChange={(e) => setNewHotel({ ...newHotel, name: e.target.value })}
                  placeholder="Grand Palace Resort"
                  className="bg-slate-950 border-slate-800 text-slate-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Destination / City</label>
                <Input
                  value={newHotel.destination}
                  onChange={(e) => setNewHotel({ ...newHotel, destination: e.target.value })}
                  placeholder="Ooty, Goa, Chennai..."
                  className="bg-slate-950 border-slate-800 text-slate-200"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Address / Location</label>
              <Input
                value={newHotel.address}
                onChange={(e) => setNewHotel({ ...newHotel, address: e.target.value })}
                placeholder="Near Lake Road"
                className="bg-slate-950 border-slate-800 text-slate-200"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Contact Phone</label>
                <Input
                  value={newHotel.contact_phone}
                  onChange={(e) => setNewHotel({ ...newHotel, contact_phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="bg-slate-950 border-slate-800 text-slate-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Star Rating</label>
                <Input
                  type="number"
                  value={newHotel.star_rating}
                  onChange={(e) => setNewHotel({ ...newHotel, star_rating: Number(e.target.value) })}
                  className="bg-slate-950 border-slate-800 text-slate-200"
                />
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3">
              <p className="text-xs font-semibold text-slate-300 mb-2">Initial Room Type & Pricing</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Room Name</label>
                  <Input
                    value={newHotel.room_name}
                    onChange={(e) => setNewHotel({ ...newHotel, room_name: e.target.value })}
                    className="bg-slate-950 border-slate-800 text-slate-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Weekday Rate</label>
                  <Input
                    type="number"
                    value={newHotel.weekday_rate}
                    onChange={(e) => setNewHotel({ ...newHotel, weekday_rate: Number(e.target.value) })}
                    className="bg-slate-950 border-slate-800 text-slate-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Weekend Rate</label>
                  <Input
                    type="number"
                    value={newHotel.weekend_rate}
                    onChange={(e) => setNewHotel({ ...newHotel, weekend_rate: Number(e.target.value) })}
                    className="bg-slate-950 border-slate-800 text-slate-200"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Hotel Photo URL</label>
              <Input
                value={newHotel.photo_url}
                onChange={(e) => setNewHotel({ ...newHotel, photo_url: e.target.value })}
                className="bg-slate-950 border-slate-800 text-slate-200"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setHotelModalOpen(false)} className="border-slate-800 text-slate-300">
              Cancel
            </Button>
            <Button onClick={handleCreateHotel} className="bg-violet-600 hover:bg-violet-500 text-white">
              Save Hotel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

