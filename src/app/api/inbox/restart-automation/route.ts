import { NextResponse } from 'next/server'
import { getServerAuthUser } from '@/lib/supabase/auth-server'
import { restartPickupAutomationForContact } from '@/lib/automations/restart-flow'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function POST(request: Request) {
  const auth = await getServerAuthUser()
  if (!auth.userId) {
    const err = 'error' in auth ? auth.error : 'Unauthorized'
    const status = 'status' in auth ? auth.status : 401
    return NextResponse.json({ error: err }, { status })
  }
  const userId = auth.userId
  const supabase = supabaseAdmin()

  const body = await request.json().catch(() => null)
  const contactId = body?.contact_id as string | undefined
  const conversationId = (body?.conversation_id as string | undefined) ?? null
  const automationId = body?.automation_id as string | undefined

  if (!contactId) {
    return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
  }

  const { data: contact, error: contactErr } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle()

  if (contactErr || !contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  if (conversationId) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .eq('contact_id', contactId)
      .maybeSingle()

    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
  }

  const result = await restartPickupAutomationForContact({
    userId,
    contactId,
    conversationId,
    automationId,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? 'Failed to restart automation', automationId: result.automationId },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    automationId: result.automationId,
    message: 'Automation session cleared and booking flow restarted.',
  })
}
