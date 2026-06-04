import { clearBookingConversationSession } from '@/lib/automations/pickup-booking-flow'
import { clearFlowSession } from '@/lib/automations/conversation-flow'
import { runAutomationForContact } from '@/lib/automations/engine'
import { supabaseAdmin } from '@/lib/automations/admin-client'

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

export async function resolvePickupAutomationId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from('automations')
    .select('id, name')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })

  if (!data?.length) return null

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

  if (!automationId) {
    return {
      ok: false,
      error: 'No active pickup/booking automation found. Please activate one in Automations first.',
      automationId: '',
    }
  }

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
