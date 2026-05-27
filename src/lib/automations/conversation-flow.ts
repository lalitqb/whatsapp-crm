import type { AutomationContext } from './engine'
import { executeAutomationFromPosition } from './engine'
import { supabaseAdmin } from './admin-client'

export interface FlowSessionRow {
  id: string
  user_id: string
  contact_id: string
  automation_id: string
  conversation_id: string | null
  log_id: string | null
  next_parent_step_id: string | null
  next_branch: 'yes' | 'no' | null
  next_position: number
  pending_reply_var: string | null
  vars: Record<string, unknown>
}

export async function getActiveFlowSession(
  userId: string,
  contactId: string,
): Promise<FlowSessionRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('automation_flow_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (error?.code === '42P01') return null
  if (error || !data) return null

  return {
    id: data.id as string,
    user_id: data.user_id as string,
    contact_id: data.contact_id as string,
    automation_id: data.automation_id as string,
    conversation_id: (data.conversation_id as string | null) ?? null,
    log_id: (data.log_id as string | null) ?? null,
    next_parent_step_id: (data.next_parent_step_id as string | null) ?? null,
    next_branch: (data.next_branch as 'yes' | 'no' | null) ?? null,
    next_position: data.next_position as number,
    pending_reply_var: (data.pending_reply_var as string | null) ?? null,
    vars: (data.vars as Record<string, unknown>) ?? {},
  }
}

export async function saveFlowSession(row: Omit<FlowSessionRow, 'id' | 'user_id'> & { userId: string }): Promise<void> {
  const { error } = await supabaseAdmin().from('automation_flow_sessions').upsert(
    {
      user_id: row.userId,
      contact_id: row.contact_id,
      automation_id: row.automation_id,
      conversation_id: row.conversation_id,
      log_id: row.log_id,
      next_parent_step_id: row.next_parent_step_id,
      next_branch: row.next_branch,
      next_position: row.next_position,
      pending_reply_var: row.pending_reply_var,
      vars: row.vars,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,contact_id,automation_id' },
  )
  if (error) console.error('[flow-session] save failed:', error)
}

export async function clearFlowSession(
  userId: string,
  contactId: string,
  automationId?: string,
): Promise<void> {
  let q = supabaseAdmin()
    .from('automation_flow_sessions')
    .delete()
    .eq('user_id', userId)
    .eq('contact_id', contactId)
  if (automationId) q = q.eq('automation_id', automationId)
  await q
}

/** Resume a paused flow when the customer sends the next message. */
export async function tryResumeAutomationFlow(args: {
  userId: string
  contactId: string
  conversationId: string
  messageText: string
  inboundMessageId?: string
  contact: { name?: string | null; phone?: string | null; email?: string | null }
}): Promise<boolean> {
  const session = await getActiveFlowSession(args.userId, args.contactId)
  if (!session) return false

  const vars = { ...session.vars }
  vars.last_reply = args.messageText
  if (session.pending_reply_var) {
    vars[session.pending_reply_var] = args.messageText
  }

  const context: AutomationContext = {
    message_text: args.messageText,
    conversation_id: args.conversationId,
    inbound_message_id: args.inboundMessageId,
    vars,
  }

  const { data: automation } = await supabaseAdmin()
    .from('automations')
    .select('*')
    .eq('id', session.automation_id)
    .maybeSingle()

  if (!automation) {
    await clearFlowSession(args.userId, args.contactId)
    return false
  }

  const completed = await executeAutomationFromPosition({
    automation,
    contactId: args.contactId,
    context,
    parentStepId: session.next_parent_step_id,
    branch: session.next_branch,
    startPosition: session.next_position,
    logId: session.log_id,
    contact: args.contact,
  })

  if (completed) {
    await clearFlowSession(args.userId, args.contactId, session.automation_id)
  }

  return true
}
