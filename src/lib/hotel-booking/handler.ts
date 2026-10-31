import { getOrCreateSettings } from './settings'
import { handleHotelInbound, type InboundHotelMessage } from './conversation'

export async function isHotelBookingEnabled(userId: string): Promise<boolean> {
  try {
    const settings = await getOrCreateSettings(userId)
    return settings.enabled
  } catch {
    return false
  }
}

export async function tryHandleHotelBooking(msg: InboundHotelMessage): Promise<boolean> {
  try {
    return await handleHotelInbound(msg)
  } catch (err) {
    console.error('[hotel-booking] inbound failed:', err)
    return false
  }
}
