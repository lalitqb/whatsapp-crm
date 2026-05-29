import type { AutomationContext } from './engine'
import { executeAutomationFromPosition } from './engine'
import { supabaseAdmin } from './admin-client'
import { isWebhookVerbose, logWebhook } from '@/lib/whatsapp/webhook-logger'
import { normalizePickupDateReply } from '@/lib/integrations/hexanova-booking'
import {
  clearFlowSession,
  getActiveFlowSession,
  saveFlowSession,
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

function isDateQuickReply(text: string, buttonId?: string): boolean {
  const hay = `${buttonId ?? ''} ${text}`.toLowerCase()
  return /\btoday\b/.test(hay) || /\btomorrow\b/.test(hay)
}

function applyReplyToVars(
  vars: Record<string, unknown>,
  pendingVar: string,
  reply: string,
  buttonId?: string,
): void {
  vars[pendingVar] = reply
  vars.last_reply = reply

  if (pendingVar === 'pickup_address' || pendingVar === 'address') {
    vars.pickup_address = reply
    vars.pickupAddress = reply
    vars.address = reply
  }
  if (pendingVar === 'pickup_date' || pendingVar === 'date') {
    const normalized = normalizePickupDateReply(reply, buttonId)
    vars.pickup_date = normalized
    vars.date = normalized
  }
  if (
    pendingVar === 'pickup_slot' ||
    pendingVar === 'timeSlot' ||
    pendingVar === 'time_slot'
  ) {
    vars.pickup_slot = reply
    vars.pickupSlot = reply
    vars.timeSlot = reply
  }
}

/** Resume a paused flow when the customer sends the next message. */
export async function tryResumeAutomationFlow(args: {
  userId: string
  contactId: string
  conversationId: string
  messageText: string
  buttonId?: string
  inboundMessageId?: string
  contact: { name?: string | null; phone?: string | null; email?: string | null }
}): Promise<boolean> {
  const retrySession = isDateQuickReply(args.messageText, args.buttonId)
  const session = await getActiveFlowSession(args.userId, args.contactId, {
    retryIfMissing: retrySession,
  })

  if (!session) {
    if (retrySession) {
      console.error('[flow] date button click but no automation session', {
        userId: args.userId,
        contactId: args.contactId,
        messageText: args.messageText,
        buttonId: args.buttonId,
      })
    } else if (isWebhookVerbose()) {
      logWebhook('[flow] no active session to resume', {
        userId: args.userId,
        contactId: args.contactId,
      })
    }
    return false
  }

  const vars = { ...session.vars }
  const rawReply = args.messageText.trim()
  let reply = rawReply

  if (session.pending_reply_var) {
    if (
      session.pending_reply_var === 'pickup_date' ||
      session.pending_reply_var === 'date'
    ) {
      reply = normalizePickupDateReply(rawReply, args.buttonId)
    }
    applyReplyToVars(vars, session.pending_reply_var, reply, args.buttonId)

    if (session.pending_reply_var === 'pickup_name' && reply.length >= 2) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name: reply, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
      args.contact.name = reply
    }

    // Persist captured reply before running steps (survives step failures / races).
    try {
      await saveFlowSession({
        userId: args.userId,
        id: session.id,
        contact_id: session.contact_id,
        automation_id: session.automation_id,
        conversation_id: session.conversation_id ?? args.conversationId,
        log_id: session.log_id,
        next_parent_step_id: session.next_parent_step_id,
        next_branch: session.next_branch,
        next_position: session.next_position,
        pending_reply_var: session.pending_reply_var,
        vars,
      })
    } catch (err) {
      console.error('[flow] pre-resume session save failed:', err)
    }
  }

  const context: AutomationContext = {
    message_text: reply || rawReply,
    conversation_id: args.conversationId,
    inbound_message_id: args.inboundMessageId,
    button_id: args.buttonId,
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

  if (isWebhookVerbose()) {
    logWebhook('[flow] resume', {
      automationId: session.automation_id,
      pendingVar: session.pending_reply_var,
      nextPosition: session.next_position,
      branch: session.next_branch,
      reply,
      buttonId: args.buttonId,
    })
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

  const stillWaiting = await getActiveFlowSession(args.userId, args.contactId, {
    retryIfMissing: true,
  })
  if (stillWaiting) {
    const stuckOnSameStep =
      stillWaiting.pending_reply_var === session.pending_reply_var &&
      stillWaiting.next_position === session.next_position

    if (stuckOnSameStep) {
      console.error('[flow] resume did not advance after reply', {
        automationId: session.automation_id,
        pendingVar: session.pending_reply_var,
        reply,
        buttonId: args.buttonId,
        nextPosition: session.next_position,
        branch: session.next_branch,
      })
    }

    if (isWebhookVerbose()) {
      logWebhook('[flow] resume paused, session kept', {
        automationId: stillWaiting.automation_id,
        pendingVar: stillWaiting.pending_reply_var,
        nextPosition: stillWaiting.next_position,
        stuckOnSameStep,
      })
    }
    return true
  }

  console.error('[flow] resume failed — session lost after reply', {
    automationId: session.automation_id,
    pendingVar: session.pending_reply_var,
    reply,
    buttonId: args.buttonId,
  })
  await clearFlowSession(args.userId, args.contactId, session.automation_id)
  return false
}
