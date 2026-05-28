import type { AutomationContext } from './engine'
import { executeAutomationFromPosition } from './engine'
import { supabaseAdmin } from './admin-client'
import { isWebhookVerbose, logWebhook } from '@/lib/whatsapp/webhook-logger'
import {
  clearFlowSession,
  getActiveFlowSession,
  type FlowSessionRow,
} from '@/lib/automations/flow-session-store'
import { getAllAutomationSteps } from '@/lib/automations/automation-cache'
import {
  getWhatsAppConfigCached,
  prefetchAutomationRuntime,
  type AutomationRuntime,
} from '@/lib/automations/runtime-cache'
import { isRedisEnabled } from '@/lib/redis/client'

export type { FlowSessionRow } from '@/lib/automations/flow-session-store'
export {
  getActiveFlowSession,
  saveFlowSession,
  clearFlowSession,
} from '@/lib/automations/flow-session-store'

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
  if (!session) {
    if (isWebhookVerbose()) {
      logWebhook('[flow] no active session to resume', {
        userId: args.userId,
        contactId: args.contactId,
      })
    }
    return false
  }

  const vars = { ...session.vars }
  vars.last_reply = args.messageText
  if (session.pending_reply_var) {
    vars[session.pending_reply_var] = args.messageText
    const reply = args.messageText.trim()
    if (
      session.pending_reply_var === 'pickup_address' ||
      session.pending_reply_var === 'address'
    ) {
      vars.pickup_address = reply
      vars.pickupAddress = reply
      vars.address = reply
    }
    if (session.pending_reply_var === 'pickup_date' || session.pending_reply_var === 'date') {
      vars.pickup_date = reply
      vars.date = reply
    }
    if (
      session.pending_reply_var === 'pickup_slot' ||
      session.pending_reply_var === 'timeSlot' ||
      session.pending_reply_var === 'time_slot'
    ) {
      vars.pickup_slot = reply
      vars.pickupSlot = reply
      vars.timeSlot = reply
    }
    if (session.pending_reply_var === 'pickup_name' && reply.length >= 2) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name: reply, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
      args.contact.name = reply
    }
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

  let whatsappConfig
  let allSteps
  if (isRedisEnabled()) {
    const prefetched = await prefetchAutomationRuntime(args.userId, session.automation_id)
    whatsappConfig =
      prefetched.whatsappConfig ?? (await getWhatsAppConfigCached(args.userId))
    allSteps =
      prefetched.allSteps.length > 0
        ? prefetched.allSteps
        : await getAllAutomationSteps(session.automation_id)
  } else {
    ;[whatsappConfig, allSteps] = await Promise.all([
      getWhatsAppConfigCached(args.userId),
      getAllAutomationSteps(session.automation_id),
    ])
  }
  const runtime: AutomationRuntime = { whatsappConfig, allSteps, typingShown: false }

  const completed = await executeAutomationFromPosition({
    automation,
    contactId: args.contactId,
    context,
    parentStepId: session.next_parent_step_id,
    branch: session.next_branch,
    startPosition: session.next_position,
    logId: session.log_id,
    contact: args.contact,
    runtime,
  })

  if (completed) {
    await clearFlowSession(args.userId, args.contactId, session.automation_id)
    if (isWebhookVerbose()) {
      logWebhook('[flow] resume completed', {
        automationId: session.automation_id,
        pendingVar: session.pending_reply_var,
      })
    }
    return true
  }

  const stillWaiting = await getActiveFlowSession(args.userId, args.contactId)
  if (stillWaiting) {
    if (isWebhookVerbose()) {
      logWebhook('[flow] resume paused, session kept', {
        automationId: stillWaiting.automation_id,
        pendingVar: stillWaiting.pending_reply_var,
        nextPosition: stillWaiting.next_position,
      })
    }
    return true
  }

  if (isWebhookVerbose()) {
    logWebhook('[flow] resume failed, session cleared', {
      automationId: session.automation_id,
    })
  }
  await clearFlowSession(args.userId, args.contactId, session.automation_id)
  return false
}
