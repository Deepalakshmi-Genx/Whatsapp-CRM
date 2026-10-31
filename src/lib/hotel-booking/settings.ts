import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { HotelBookingSettings } from './types'

export async function getOrCreateSettings(userId: string): Promise<HotelBookingSettings> {
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('hotel_booking_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (existing) return existing as HotelBookingSettings

  const { data: created, error } = await db
    .from('hotel_booking_settings')
    .insert({ user_id: userId })
    .select('*')
    .single()
  if (error || !created) {
    throw new Error(error?.message ?? 'Unable to create hotel booking settings')
  }
  return created as HotelBookingSettings
}
