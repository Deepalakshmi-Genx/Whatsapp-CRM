import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const takeover = searchParams.get('takeover')
  const limit = Math.min(Number(searchParams.get('limit') || 50), 100)
  const offset = Number(searchParams.get('offset') || 0)

  const db = supabaseAdmin()
  let query = db
    .from('hotel_enquiries')
    .select(`
      *,
      contacts (id, name, phone, email)
    `)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  if (takeover === 'true') {
    query = query.eq('human_takeover', true)
  }

  const { data: enquiries, error } = await query

  if (error) {
    if (error.code === 'PGRST205' || error.message.includes('hotel_enquiries')) {
      return NextResponse.json({ enquiries: [], migrationNeeded: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let filtered = enquiries ?? []
  if (search && search.trim()) {
    const s = search.toLowerCase()
    filtered = filtered.filter((e) => {
      const contact = e.contacts as { name?: string; phone?: string } | null
      const contactName = (contact?.name ?? '').toLowerCase()
      const contactPhone = (contact?.phone ?? '').toLowerCase()
      const collectedName = ((e.collected as Record<string, unknown>)?.customer_name as string ?? '').toLowerCase()
      const destination = ((e.collected as Record<string, unknown>)?.destination as string ?? '').toLowerCase()
      return (
        contactName.includes(s) ||
        contactPhone.includes(s) ||
        collectedName.includes(s) ||
        destination.includes(s)
      )
    })
  }

  return NextResponse.json({ enquiries: filtered })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || !body.id) {
    return NextResponse.json({ error: 'Missing enquiry id' }, { status: 400 })
  }

  const db = supabaseAdmin()
  const patch: Record<string, unknown> = {}

  if ('human_takeover' in body) {
    patch.human_takeover = Boolean(body.human_takeover)
    if (patch.human_takeover && body.handover_reason) {
      patch.handover_reason = body.handover_reason
    } else if (!patch.human_takeover) {
      patch.handover_reason = null
    }
  }

  if ('internal_notes' in body) {
    patch.internal_notes = body.internal_notes
  }

  if ('assigned_agent_id' in body) {
    patch.assigned_agent_id = body.assigned_agent_id
  }

  const { data: updated, error } = await db
    .from('hotel_enquiries')
    .update(patch)
    .eq('id', body.id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ enquiry: updated })
}
