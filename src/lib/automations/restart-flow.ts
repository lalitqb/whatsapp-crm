import { clearBookingConversationSession } from '@/lib/automations/pickup-booking-flow'
import { clearFlowSession } from '@/lib/automations/conversation-flow'
import { runAutomationForContact } from '@/lib/automations/engine'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/** Default pickup automation (override with PICKUP_AUTOMATION_ID env). */
export const DEFAULT_PICKUP_AUTOMATION_ID =
  process.env.PICKUP_AUTOMATION_ID ?? '7a939c2b-8289-411d-8f46-b70069edb209'

export async function resetContactAutomationState(args: {
  userId: string
  contactId: string
  automationId?: string
}): Promise<void> {
  await clearFlowSession(args.userId, args.contactId, args.automationId)
  await clearBookingConversationSession(args.userId, args.contactId)

  let pending = supabaseAdmin()
    .from('automation_pending_executions')
    .delete()
    .eq('user_id', args.userId)
    .eq('contact_id', args.contactId)
    .eq('status', 'pending')

  if (args.automationId) {
    pending = pending.eq('automation_id', args.automationId)
  }
  await pending
}

export async function resolvePickupAutomationId(userId: string): Promise<string> {
  const configured = process.env.PICKUP_AUTOMATION_ID?.trim()
  if (configured) return configured

  const { data } = await supabaseAdmin()
    .from('automations')
    .select('id, name')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })

  if (!data?.length) return DEFAULT_PICKUP_AUTOMATION_ID

  const pickup = data.find((a) => /pickup|booking/i.test(String(a.name)))
  return pickup?.id ?? data[0].id
}

export async function restartPickupAutomationForContact(args: {
  userId: string
  contactId: string
  conversationId?: string | null
  automationId?: string
}): Promise<{ ok: boolean; error?: string; automationId: string }> {
  const automationId =
    args.automationId?.trim() || (await resolvePickupAutomationId(args.userId))

  await resetContactAutomationState({
    userId: args.userId,
    contactId: args.contactId,
    automationId,
  })

  const result = await runAutomationForContact({
    userId: args.userId,
    automationId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    triggerEvent: 'inbox_restart',
    messageText: 'book pickup',
  })

  return { ...result, automationId }
}
