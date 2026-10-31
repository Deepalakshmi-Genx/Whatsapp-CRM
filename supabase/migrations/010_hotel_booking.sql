-- ============================================================
-- 010_hotel_booking.sql — WhatsApp hotel booking automation
-- Idempotent. Safe to run multiple times.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- SETTINGS (one row per CRM user)
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_booking_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  welcome_message TEXT NOT NULL DEFAULT $msg$Hi! Welcome to our Hotel Booking Service 😊

We're happy to help you find the perfect hotel for your trip.

Let's find the best option based on your travel dates, number of guests, location, and budget.$msg$,
  budget_prompt TEXT NOT NULL DEFAULT $msg$Thanks! Now, what's your preferred budget for your stay?

You can share your total budget or your preferred price per room per night. I'll find the best available options for you.$msg$,
  advance_percent NUMERIC(5,2) NOT NULL DEFAULT 20.00,
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_deadline_hours INTEGER NOT NULL DEFAULT 6,
  room_hold_hours INTEGER NOT NULL DEFAULT 6,
  require_hotel_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
  upi_id TEXT,
  upi_payee_name TEXT,
  upi_qr_image_url TEXT,
  payment_instructions TEXT NOT NULL DEFAULT 'Pay the advance via UPI using the QR code or UPI ID. After paying, send the UTR / transaction ID here. We will verify the payment before confirming the room.',
  followup_details_hours INTEGER NOT NULL DEFAULT 2,
  followup_budget_hours INTEGER NOT NULL DEFAULT 2,
  followup_options_hours INTEGER NOT NULL DEFAULT 4,
  followup_confirm_hours INTEGER NOT NULL DEFAULT 2,
  followup_payment_hours INTEGER NOT NULL DEFAULT 2,
  max_followups INTEGER NOT NULL DEFAULT 3,
  reminder_days_before_checkin INTEGER NOT NULL DEFAULT 2,
  send_checkin_day_reminder BOOLEAN NOT NULL DEFAULT TRUE,
  send_post_stay_feedback BOOLEAN NOT NULL DEFAULT TRUE,
  tax_label TEXT NOT NULL DEFAULT 'GST',
  default_tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  supported_languages TEXT[] NOT NULL DEFAULT ARRAY['en','ta','tanglish'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE hotel_booking_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own hotel booking settings" ON hotel_booking_settings;
CREATE POLICY "Users can manage own hotel booking settings" ON hotel_booking_settings
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- HOTELS
-- ============================================================
CREATE TABLE IF NOT EXISTS hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT,
  description TEXT,
  short_description TEXT,
  destination TEXT NOT NULL,
  address TEXT,
  landmark TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  contact_phone TEXT,
  contact_email TEXT,
  star_rating NUMERIC(2,1),
  amenities TEXT[] NOT NULL DEFAULT '{}',
  cancellation_policy TEXT NOT NULL DEFAULT 'Free cancellation up to 24 hours before check-in. After that the advance may be non-refundable, subject to hotel policy.',
  terms TEXT,
  check_in_time TEXT NOT NULL DEFAULT '14:00',
  check_out_time TEXT NOT NULL DEFAULT '11:00',
  min_stay_nights INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ranking_boost INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotels_user ON hotels(user_id);
CREATE INDEX IF NOT EXISTS idx_hotels_destination ON hotels(user_id, destination);

ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own hotels" ON hotels;
CREATE POLICY "Users can manage own hotels" ON hotels
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- HOTEL PHOTOS
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type_id UUID,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('exterior','bedroom','bathroom','pool','restaurant','amenity','other')),
  image_url TEXT NOT NULL,
  caption TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotel_photos_hotel ON hotel_photos(hotel_id);

ALTER TABLE hotel_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage photos of own hotels" ON hotel_photos;
CREATE POLICY "Users can manage photos of own hotels" ON hotel_photos
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hotels h WHERE h.id = hotel_photos.hotel_id AND h.user_id = auth.uid())
  );

-- ============================================================
-- ROOM TYPES
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_room_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  max_adults INTEGER NOT NULL DEFAULT 2,
  max_children INTEGER NOT NULL DEFAULT 2,
  max_occupancy INTEGER NOT NULL DEFAULT 3,
  included_adults INTEGER NOT NULL DEFAULT 2,
  included_children INTEGER NOT NULL DEFAULT 0,
  extra_adult_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
  extra_child_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
  base_weekday_rate NUMERIC(12,2) NOT NULL,
  base_weekend_rate NUMERIC(12,2),
  total_rooms INTEGER NOT NULL DEFAULT 1,
  amenities TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_types_hotel ON hotel_room_types(hotel_id);

ALTER TABLE hotel_room_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage room types of own hotels" ON hotel_room_types;
CREATE POLICY "Users can manage room types of own hotels" ON hotel_room_types
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hotels h WHERE h.id = hotel_room_types.hotel_id AND h.user_id = auth.uid())
  );

ALTER TABLE hotel_photos
  DROP CONSTRAINT IF EXISTS hotel_photos_room_type_id_fkey;
ALTER TABLE hotel_photos
  ADD CONSTRAINT hotel_photos_room_type_id_fkey
  FOREIGN KEY (room_type_id) REFERENCES hotel_room_types(id) ON DELETE SET NULL;

-- ============================================================
-- DATE-SPECIFIC RATES / RESTRICTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_rate_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id UUID NOT NULL REFERENCES hotel_room_types(id) ON DELETE CASCADE,
  stay_date DATE NOT NULL,
  rate NUMERIC(12,2),
  available_rooms INTEGER,
  min_stay_nights INTEGER,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(room_type_id, stay_date)
);

CREATE INDEX IF NOT EXISTS idx_rate_calendar_room_date ON hotel_rate_calendar(room_type_id, stay_date);

ALTER TABLE hotel_rate_calendar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage rate calendar of own hotels" ON hotel_rate_calendar;
CREATE POLICY "Users can manage rate calendar of own hotels" ON hotel_rate_calendar
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM hotel_room_types rt
      JOIN hotels h ON h.id = rt.hotel_id
      WHERE rt.id = hotel_rate_calendar.room_type_id AND h.user_id = auth.uid()
    )
  );

-- ============================================================
-- SEASONAL RULES
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_seasonal_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  room_type_id UUID REFERENCES hotel_room_types(id) ON DELETE CASCADE,
  rate NUMERIC(12,2),
  multiplier NUMERIC(6,3) NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hotel_seasonal_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage seasonal rates of own hotels" ON hotel_seasonal_rates;
CREATE POLICY "Users can manage seasonal rates of own hotels" ON hotel_seasonal_rates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hotels h WHERE h.id = hotel_seasonal_rates.hotel_id AND h.user_id = auth.uid())
  );

-- ============================================================
-- TAXES / FEES
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_taxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  percent NUMERIC(6,3) NOT NULL DEFAULT 0,
  fixed_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE hotel_taxes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage taxes of own hotels" ON hotel_taxes;
CREATE POLICY "Users can manage taxes of own hotels" ON hotel_taxes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hotels h WHERE h.id = hotel_taxes.hotel_id AND h.user_id = auth.uid())
  );

-- ============================================================
-- ENQUIRIES (conversation state)
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new_enquiry',
  collected JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_question TEXT,
  followup_count INTEGER NOT NULL DEFAULT 0,
  human_takeover BOOLEAN NOT NULL DEFAULT FALSE,
  handover_reason TEXT,
  assigned_agent_id UUID,
  internal_notes TEXT,
  last_customer_message_at TIMESTAMPTZ,
  last_bot_message_at TIMESTAMPTZ,
  last_inbound_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enquiries_user ON hotel_enquiries(user_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_contact ON hotel_enquiries(contact_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_status ON hotel_enquiries(user_id, status);

ALTER TABLE hotel_enquiries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own enquiries" ON hotel_enquiries;
CREATE POLICY "Users can manage own enquiries" ON hotel_enquiries
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enquiry_id UUID REFERENCES hotel_enquiries(id) ON DELETE SET NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE RESTRICT,
  room_type_id UUID NOT NULL REFERENCES hotel_room_types(id) ON DELETE RESTRICT,
  booking_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_customer_confirmation',
  customer_name TEXT,
  customer_phone TEXT,
  destination TEXT,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  nights INTEGER NOT NULL,
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  child_ages INTEGER[] NOT NULL DEFAULT '{}',
  rooms INTEGER NOT NULL DEFAULT 1,
  special_requirements TEXT,
  currency TEXT NOT NULL DEFAULT 'INR',
  night_rates JSONB NOT NULL DEFAULT '[]'::jsonb,
  room_subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  extra_charges NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  advance_percent NUMERIC(5,2) NOT NULL DEFAULT 20,
  advance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  quoted_at TIMESTAMPTZ,
  price_locked BOOLEAN NOT NULL DEFAULT FALSE,
  cancellation_policy TEXT,
  hotel_confirmed_at TIMESTAMPTZ,
  hold_expires_at TIMESTAMPTZ,
  payment_deadline_at TIMESTAMPTZ,
  checkin_reminder_sent_at TIMESTAMPTZ,
  arrival_reminder_sent_at TIMESTAMPTZ,
  feedback_sent_at TIMESTAMPTZ,
  cancel_reason TEXT,
  refund_amount NUMERIC(12,2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, booking_ref)
);

CREATE INDEX IF NOT EXISTS idx_bookings_user ON hotel_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON hotel_bookings(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON hotel_bookings(hotel_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_contact ON hotel_bookings(contact_id);

ALTER TABLE hotel_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own bookings" ON hotel_bookings;
CREATE POLICY "Users can manage own bookings" ON hotel_bookings
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- STATUS HISTORY / AUDIT
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enquiry_id UUID REFERENCES hotel_enquiries(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES hotel_bookings(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_history_booking ON hotel_status_history(booking_id);

ALTER TABLE hotel_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own status history" ON hotel_status_history;
CREATE POLICY "Users can view own status history" ON hotel_status_history
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- ROOM HOLDS (prevent double booking during payment window)
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_room_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES hotel_bookings(id) ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES hotel_room_types(id) ON DELETE CASCADE,
  stay_date DATE NOT NULL,
  rooms INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','converted')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holds_room_date ON hotel_room_holds(room_type_id, stay_date)
  WHERE status = 'active';

ALTER TABLE hotel_room_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage holds of own bookings" ON hotel_room_holds;
CREATE POLICY "Users can manage holds of own bookings" ON hotel_room_holds
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hotel_bookings b WHERE b.id = hotel_room_holds.booking_id AND b.user_id = auth.uid())
  );

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES hotel_bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'advance' CHECK (kind IN ('advance','balance','refund')),
  expected_amount NUMERIC(12,2) NOT NULL,
  received_amount NUMERIC(12,2),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN (
      'initiated','pending','customer_reported','verification_pending',
      'successful','failed','expired','incorrect_amount','duplicate','reversed','refund_pending','refund_processed'
    )),
  upi_id TEXT,
  upi_link TEXT,
  transaction_ref TEXT,
  customer_note TEXT,
  verified_at TIMESTAMPTZ,
  verified_by UUID,
  verification_notes TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_booking ON hotel_payments(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_txn_unique
  ON hotel_payments(user_id, transaction_ref)
  WHERE transaction_ref IS NOT NULL AND status = 'successful';

ALTER TABLE hotel_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own payments" ON hotel_payments;
CREATE POLICY "Users can manage own payments" ON hotel_payments
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- SCHEDULED FOLLOW-UPS / REMINDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enquiry_id UUID REFERENCES hotel_enquiries(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES hotel_bookings(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID,
  kind TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 1,
  run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','sent','cancelled','failed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_due ON hotel_scheduled_messages(status, run_at);

ALTER TABLE hotel_scheduled_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own scheduled messages" ON hotel_scheduled_messages;
CREATE POLICY "Users can manage own scheduled messages" ON hotel_scheduled_messages
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- ACTIVITY LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enquiry_id UUID,
  booking_id UUID,
  contact_id UUID,
  event_type TEXT NOT NULL,
  detail TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON hotel_activity_log(user_id, created_at DESC);

ALTER TABLE hotel_activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own hotel activity" ON hotel_activity_log;
CREATE POLICY "Users can view own hotel activity" ON hotel_activity_log
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- ADMIN NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  event_type TEXT NOT NULL,
  booking_id UUID,
  enquiry_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notif_user ON hotel_admin_notifications(user_id, is_read, created_at DESC);

ALTER TABLE hotel_admin_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own hotel notifications" ON hotel_admin_notifications;
CREATE POLICY "Users can manage own hotel notifications" ON hotel_admin_notifications
  FOR ALL USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON hotel_booking_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hotel_booking_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON hotels;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hotels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON hotel_room_types;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hotel_room_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON hotel_enquiries;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hotel_enquiries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON hotel_bookings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hotel_bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON hotel_payments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hotel_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
