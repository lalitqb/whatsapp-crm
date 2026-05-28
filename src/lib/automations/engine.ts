import { startPickupBookingFlow } from '@/lib/automations/pickup-booking-flow'
import { messageMatchesKeywordTrigger } from '@/lib/automations/trigger-config'
import {
  normalizeCustomerPayload,
  parseCustomerLookupResult,
} from '@/lib/integrations/hexanova-booking'
import { isWebhookVerbose, logWebhook } from '@/lib/whatsapp/webhook-logger'
import type {
  Automation,
  AutomationLogStepResult,
  AutomationStep,
  AutomationTriggerType,
  ConditionStepConfig,
  SendMessageStepConfig,
  SendTemplateStepConfig,
  SendWebhookStepConfig,
  HttpRequestStepConfig,
  WaitForReplyStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
  CreateDealStepConfig,
  AssignConversationStepConfig,
} from '@/types'
import { supabaseAdmin } from './admin-client'
import { getNestedVar, interpolate as interpolateTemplate } from './interpolate'
import { engineSendText, engineSendTemplate } from './meta-send'

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  /** Raw message text, for keyword_match + message_content conditions. */
  message_text?: string
  /** Conversation the event belongs to, if any. */
  conversation_id?: string
  /** Arbitrary variables accumulated during execution. */
  vars?: Record<string, unknown>
  /** The tag id that was added, for tag_added trigger. */
  tag_id?: string
  /** Agent the conversation was assigned to, for conversation_assigned. */
  agent_id?: string
  /** Quick-reply / template button id from WhatsApp interactive payload. */
  button_id?: string
  /** Inbound customer message id (wamid...), used for read/typing indicators. */
  inbound_message_id?: string
}

export interface DispatchInput {
  userId: string
  triggerType: AutomationTriggerType
  contactId?: string | null
  context?: AutomationContext
}

/**
 * Fire all active automations matching the given trigger for a user.
 *
 * Must never throw — callers use fire-and-forget from the webhook.
 * All errors are caught and logged; per-automation failures are
 * recorded into automation_logs with status='failed'.
 */
export async function runAutomationsForTrigger(input: DispatchInput): Promise<void> {
  try {
    const db = supabaseAdmin()
    const { data: automations, error } = await db
      .from('automations')
      .select('*')
      .eq('user_id', input.userId)
      .eq('trigger_type', input.triggerType)
      .eq('is_active', true)

    if (error) {
      console.error('[automations] fetch failed:', error)
      return
    }
    if (!automations || automations.length === 0) {
      if (isWebhookVerbose()) {
        logWebhook('[automations] no active automations for trigger', {
          triggerType: input.triggerType,
          userId: input.userId,
        })
      }
      return
    }

    const verbose = isWebhookVerbose()
    const skipped: { id: string; name: string; reason: string }[] = []
    let ran = 0

    for (const automation of automations as Automation[]) {
      if (!triggerMatches(automation, input.context)) {
        if (verbose && automation.trigger_type === 'keyword_match') {
          skipped.push({
            id: automation.id,
            name: automation.name,
            reason: 'keyword did not match message',
          })
        }
        continue
      }
      try {
        await executeAutomation(automation, input)
        ran += 1
      } catch (err) {
        console.error('[automations] execute failed:', automation.id, err)
      }
    }

    if (verbose) {
      logWebhook('[automations] dispatch complete', {
        triggerType: input.triggerType,
        userId: input.userId,
        message_text: input.context?.message_text,
        candidates: automations.length,
        ran,
        skipped,
      })
    }
  } catch (err) {
    console.error('[automations] dispatch failed:', err)
  }
}

/**
 * Resume a run that was parked at a wait step. Called from the cron
 * endpoint after it grabs a due `automation_pending_executions` row.
 */
export async function resumePendingExecution(pending: {
  id: string
  automation_id: string
  user_id: string
  contact_id: string | null
  log_id: string | null
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  context: AutomationContext
}): Promise<void> {
  const db = supabaseAdmin()
  const { data: automation, error } = await db
    .from('automations')
    .select('*')
    .eq('id', pending.automation_id)
    .single()

  if (error || !automation) {
    console.error('[automations] resume: missing automation', pending.automation_id, error)
    await markPending(pending.id, 'failed')
    return
  }

  try {
    await executeStepsFrom({
      automation: automation as Automation,
      contactId: pending.contact_id,
      context: pending.context ?? {},
      parentStepId: pending.parent_step_id,
      branch: pending.branch,
      startPosition: pending.next_step_position,
      logId: pending.log_id,
      triggerEvent: 'resumed_wait',
    })
    await markPending(pending.id, 'done')
  } catch (err) {
    console.error('[automations] resume failed:', err)
    await markPending(pending.id, 'failed')
  }
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

async function executeAutomation(automation: Automation, input: DispatchInput) {
  const db = supabaseAdmin()

  const { data: log, error: logErr } = await db
    .from('automation_logs')
    .insert({
      automation_id: automation.id,
      user_id: automation.user_id,
      contact_id: input.contactId ?? null,
      trigger_event: input.triggerType,
      steps_executed: [],
      status: 'success',
    })
    .select()
    .single()

  if (logErr || !log) {
    console.error('[automations] cannot create log:', logErr)
    return
  }

  const contact = input.contactId
    ? await loadContactForAutomation(automation.user_id, input.contactId)
    : undefined

  const completed = await executeStepsFrom({
    automation,
    contactId: input.contactId ?? null,
    context: input.context ?? {},
    parentStepId: null,
    branch: null,
    startPosition: 0,
    logId: log.id,
    triggerEvent: input.triggerType,
    contact,
  })

  if (!completed) return

  // Atomic counter update via the SQL function from migration 007.
  // Doing this with a client-side read-modify-write raced when the
  // same automation fired for two contacts simultaneously — both
  // would read N and both write N+1, losing one count permanently.
  const { error: rpcErr } = await db.rpc('increment_automation_execution_count', {
    p_automation_id: automation.id,
  })
  if (rpcErr) {
    console.error('[automations] increment counter failed:', rpcErr)
  }
}

interface ExecuteArgs {
  automation: Automation
  contactId: string | null
  context: AutomationContext
  parentStepId: string | null
  branch: 'yes' | 'no' | null
  startPosition: number
  logId: string | null
  triggerEvent: string
  contact?: { name?: string | null; phone?: string | null; email?: string | null }
}

/** Resume or continue a multi-turn flow from a saved position. Returns true when finished. */
export async function executeAutomationFromPosition(params: {
  automation: Automation
  contactId: string
  context: AutomationContext
  parentStepId: string | null
  branch: 'yes' | 'no' | null
  startPosition: number
  logId: string | null
  contact?: { name?: string | null; phone?: string | null; email?: string | null }
}): Promise<boolean> {
  const contact =
    params.contact ??
    (await loadContactForAutomation(params.automation.user_id, params.contactId))

  return executeStepsFrom({
    automation: params.automation,
    contactId: params.contactId,
    context: params.context,
    parentStepId: params.parentStepId,
    branch: params.branch,
    startPosition: params.startPosition,
    logId: params.logId,
    triggerEvent: 'flow_resume',
    contact,
  })
}

/** @returns true when the scope finished; false when paused (wait / wait_for_reply). */
async function executeStepsFrom(args: ExecuteArgs): Promise<boolean> {
  const db = supabaseAdmin()

  const baseQuery = db
    .from('automation_steps')
    .select('*')
    .eq('automation_id', args.automation.id)
    .gte('position', args.startPosition)
    .order('position', { ascending: true })

  const scoped =
    args.parentStepId === null
      ? baseQuery.is('parent_step_id', null)
      : baseQuery.eq('parent_step_id', args.parentStepId).eq('branch', args.branch ?? 'yes')

  const { data: steps, error: stepsErr } = await scoped

  if (stepsErr) {
    await finalizeLog(args.logId, 'failed', stepsErr.message)
    return false
  }
  if (!steps || steps.length === 0) {
    if (args.parentStepId === null && args.logId) {
      await finalizeLog(args.logId, 'success', null)
    }
    return true
  }

  const results: AutomationLogStepResult[] = []
  let status: 'success' | 'partial' | 'failed' = 'success'
  let errorMessage: string | null = null

  for (const step of steps as AutomationStep[]) {
    // `wait` is the suspension point: enqueue and stop processing this
    // scope. The cron endpoint will pick it up later.
    if (step.step_type === 'wait') {
      const cfg = step.step_config as WaitStepConfig
      const ms = waitMs(cfg)
      await db.from('automation_pending_executions').insert({
        automation_id: args.automation.id,
        user_id: args.automation.user_id,
        contact_id: args.contactId,
        log_id: args.logId,
        parent_step_id: args.parentStepId,
        branch: args.branch,
        next_step_position: step.position + 1,
        context: args.context,
        run_at: new Date(Date.now() + ms).toISOString(),
        status: 'pending',
      })
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail: `waiting ${cfg.amount} ${cfg.unit}`,
      })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return false
    }

    if (step.step_type === 'wait_for_reply') {
      const cfg = step.step_config as WaitForReplyStepConfig
      if (!args.contactId) {
        status = 'failed'
        errorMessage = 'wait_for_reply needs a contact'
        break
      }
      try {
        const conversationId =
          args.context.conversation_id ?? (await resolveConversationId(args))
        const vars = { ...(args.context.vars ?? {}) }
        const { error: sessErr } = await db.from('automation_flow_sessions').upsert(
          {
            user_id: args.automation.user_id,
            contact_id: args.contactId,
            automation_id: args.automation.id,
            conversation_id: conversationId,
            log_id: args.logId,
            next_parent_step_id: args.parentStepId,
            next_branch: args.branch,
            next_position: step.position + 1,
            pending_reply_var: cfg.save_reply_to?.trim() || null,
            vars,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,contact_id,automation_id' },
        )
        if (
          sessErr?.code === '42P01' ||
          sessErr?.message?.includes('automation_flow_sessions')
        ) {
          throw new Error(
            'Multi-turn automations need the automation_flow_sessions table. In Supabase → SQL Editor, run supabase/migrations/015_automation_flow_sessions.sql',
          )
        }
        if (sessErr) throw new Error(sessErr.message)
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'success',
          detail: cfg.save_reply_to
            ? `waiting for reply → vars.${cfg.save_reply_to}`
            : 'waiting for reply',
        })
        status = 'partial'
        await appendResults(args.logId, results, status, errorMessage)
        return false
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'failed',
          detail: msg,
        })
        status = 'failed'
        errorMessage = msg
        break
      }
    }

    try {
      if (step.step_type === 'condition') {
        const cfg = step.step_config as ConditionStepConfig
        const taken = await evaluateCondition(cfg, args)
        results.push({
          step_id: step.id,
          step_type: 'condition',
          status: 'success',
          detail: `branch=${taken ? 'yes' : 'no'}`,
        })
        const branchDone = await executeStepsFrom({
          ...args,
          parentStepId: step.id,
          branch: taken ? 'yes' : 'no',
          startPosition: 0,
          logId: args.logId,
        })
        if (!branchDone) {
          if (args.parentStepId === null) {
            await appendResults(args.logId, results, 'partial', null)
          } else {
            await appendResults(args.logId, results, null, null)
          }
          return false
        }
        continue
      }

      const detail = await runStep(step, args)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'failed',
        detail: msg,
      })
      status = 'failed'
      errorMessage = msg
      break
    }
  }

  if (args.parentStepId === null) {
    await appendResults(args.logId, results, status, errorMessage)
    if (args.logId && status !== 'failed') {
      await finalizeLog(args.logId, 'success', errorMessage)
    }
  } else {
    await appendResults(args.logId, results, null, errorMessage)
  }

  return status !== 'failed'
}

async function runStep(step: AutomationStep, args: ExecuteArgs): Promise<string> {
  const db = supabaseAdmin()

  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig
      if (!args.contactId) throw new Error('send_message needs a contact')
      const text = interpolate(cfg.text, args)
      if (!text.trim()) throw new Error('send_message has empty text')
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendText({
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        text,
        inboundMessageId: args.context.inbound_message_id,
      })
      return `sent via Meta (${whatsapp_message_id})`
    }

    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig
      if (!args.contactId) throw new Error('send_template needs a contact')
      if (!cfg.template_name) throw new Error('send_template needs template_name')
      const conversationId = await resolveConversationId(args)
      // Meta templates use positional {{1}}, {{2}}, … placeholders, so
      // we MUST emit params in strict numeric order. Lexicographic sort
      // of "1", "2", …, "10" yields "1", "10", "2", … which silently
      // scrambles every template with ≥10 variables.
      const { whatsapp_message_id } = await engineSendTemplate({
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        variables: cfg.variables,
        inboundMessageId: args.context.inbound_message_id,
      })
      return `template sent via Meta (${whatsapp_message_id})`
    }

    case 'add_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('add_tag needs contact + tag_id')
      await db
        .from('contact_tags')
        .upsert(
          { contact_id: args.contactId, tag_id: cfg.tag_id },
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
        )
      return `tag ${cfg.tag_id} added`
    }

    case 'remove_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('remove_tag needs contact + tag_id')
      await db
        .from('contact_tags')
        .delete()
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.tag_id)
      return `tag ${cfg.tag_id} removed`
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig
      if (!args.contactId) throw new Error('assign_conversation needs a contact')
      let agentId = cfg.agent_id
      if (cfg.mode === 'round_robin') {
        const { data: profiles } = await db
          .from('profiles')
          .select('user_id')
          .eq('user_id', args.automation.user_id)
          .limit(1)
        agentId = profiles?.[0]?.user_id
      }
      if (!agentId) return 'no agent resolved'
      await db
        .from('conversations')
        .update({ assigned_agent_id: agentId })
        .eq('user_id', args.automation.user_id)
        .eq('contact_id', args.contactId)
      return `assigned to ${agentId}`
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig
      if (!args.contactId) throw new Error('update_contact_field needs a contact')
      const allowed = new Set(['name', 'email', 'company'])
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`
      }
      await db
        .from('contacts')
        .update({ [cfg.field]: cfg.value, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
      return `${cfg.field} updated`
    }

    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig
      if (!cfg.pipeline_id || !cfg.stage_id) throw new Error('create_deal needs pipeline + stage')
      await db.from('deals').insert({
        user_id: args.automation.user_id,
        pipeline_id: cfg.pipeline_id,
        stage_id: cfg.stage_id,
        contact_id: args.contactId,
        title: interpolate(cfg.title, args),
        value: cfg.value ?? 0,
        status: 'open',
      })
      return 'deal created'
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig
      if (!cfg.url) throw new Error('send_webhook needs url')
      const method = (cfg.method ?? 'POST').toUpperCase()
      const url = tpl(cfg.url, args)
      const headers = interpolateHeaders(cfg.headers, args)
      const init: RequestInit = { method, headers }
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = cfg.body_template
          ? tpl(cfg.body_template, args)
          : JSON.stringify(args.context)
        if (!headers['content-type'] && !headers['Content-Type']) {
          headers['content-type'] = 'application/json'
        }
      }
      const res = await fetch(url, init)
      if (!res.ok) throw new Error(`webhook returned ${res.status}`)
      return `webhook ${res.status}`
    }

    case 'http_request': {
      const cfg = step.step_config as HttpRequestStepConfig
      if (!cfg.url?.trim()) throw new Error('http_request needs url')
      if (!cfg.store_as?.trim()) throw new Error('http_request needs store_as')
      const method = (cfg.method ?? 'GET').toUpperCase()
      const url = tpl(cfg.url, args)
      const headers = interpolateHeaders(cfg.headers, args)
      const init: RequestInit = { method, headers }
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = cfg.body_template ? tpl(cfg.body_template, args) : undefined
        if (init.body && !headers['content-type'] && !headers['Content-Type']) {
          headers['content-type'] = 'application/json'
        }
      }
      const res = await fetch(url, init)
      const text = await res.text()
      let data: unknown = text
      try {
        data = JSON.parse(text)
      } catch {
        // keep raw text
      }

      const vars = { ...(args.context.vars ?? {}) }

      // Customer lookup: 404 / not-found means "new customer" — continue to condition No branch.
      if (!res.ok && isCustomerLookupUrl(url) && isCustomerNotFoundResponse(res.status, data)) {
        applyCustomerLookupMiss(vars, cfg.store_as, data)
        args.context.vars = vars
        return `customer lookup ${res.status} → vars.customer_found=false`
      }

      if (!res.ok) {
        const errMsg = httpErrorMessage(data, text, res.status)
        if (isBookingCreateUrl(url)) {
          await notifyBookingFailure(args, errMsg)
        }
        throw new Error(`http_request ${res.status}: ${errMsg}`)
      }

      applyHttpResponseToVars(url, data, vars, cfg.store_as)
      args.context.vars = vars
      return `stored in vars.${cfg.store_as}`
    }

    case 'start_pickup_booking': {
      if (!args.contactId) throw new Error('start_pickup_booking needs a contact')
      const conversationId = await resolveConversationId(args)
      const { data: contact } = await supabaseAdmin()
        .from('contacts')
        .select('phone, name')
        .eq('id', args.contactId)
        .eq('user_id', args.automation.user_id)
        .maybeSingle()
      await startPickupBookingFlow({
        userId: args.automation.user_id,
        contactId: args.contactId,
        conversationId,
        contactPhone: contact?.phone ?? '',
        contactName: contact?.name ?? null,
      })
      return 'pickup booking flow started'
    }

    case 'close_conversation': {
      if (!args.contactId) throw new Error('close_conversation needs a contact')
      await db
        .from('conversations')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('user_id', args.automation.user_id)
        .eq('contact_id', args.contactId)
      return 'conversation closed'
    }

    default:
      return `unknown step: ${step.step_type}`
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Pick the conversation a send-type step should use. Prefer the id the
 * webhook handed us (it's the one that just got the inbound message);
 * fall back to the contact's conversation for resumed/wait paths and
 * manual engine POSTs. Throws if none exists — send steps have
 * no meaningful target without a conversation.
 */
async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  const fromCtx = args.context.conversation_id
  if (fromCtx) return fromCtx
  if (!args.contactId) throw new Error('cannot resolve conversation: no contact')
  const { data, error } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('user_id', args.automation.user_id)
    .eq('contact_id', args.contactId)
    .maybeSingle()
  if (error) throw new Error(`conversation lookup failed: ${error.message}`)
  if (!data?.id) throw new Error('no conversation for contact')
  return data.id as string
}

function triggerMatches(automation: Automation, ctx: AutomationContext | undefined): boolean {
  if (automation.trigger_type !== 'keyword_match') return true
  return messageMatchesKeywordTrigger(
    (ctx?.message_text ?? '').toString(),
    automation.trigger_config as Record<string, unknown>,
  )
}

async function evaluateCondition(cfg: ConditionStepConfig, args: ExecuteArgs): Promise<boolean> {
  const db = supabaseAdmin()
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false
      const { count } = await db
        .from('contact_tags')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.operand)
      return (count ?? 0) > 0
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false
      const { data } = await db
        .from('contacts')
        .select(cfg.operand)
        .eq('id', args.contactId)
        .maybeSingle()
      const v = (data as Record<string, unknown> | null)?.[cfg.operand]
      return v != null && String(v) === String(cfg.value ?? '')
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toString()
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase())
    }
    case 'time_of_day': {
      // operand form "HH:mm-HH:mm" — true if now is within that window
      // (supports over-midnight ranges like "18:00-09:00").
      const [from, to] = (cfg.operand ?? '').split('-')
      if (!from || !to) return false
      const now = new Date()
      const mins = now.getHours() * 60 + now.getMinutes()
      const parse = (s: string) => {
        const [h, m] = s.split(':').map(Number)
        return (h || 0) * 60 + (m || 0)
      }
      const f = parse(from)
      const t = parse(to)
      return f <= t ? mins >= f && mins < t : mins >= f || mins < t
    }
    case 'variable_truthy': {
      const path = (cfg.operand ?? '').trim()
      if (!path) return false
      const v =
        getNestedVar(args.context.vars, path) ??
        args.context.vars?.[path]
      return Boolean(v)
    }
    case 'variable_equals': {
      const path = (cfg.operand ?? '').trim()
      if (!path) return false
      const v =
        getNestedVar(args.context.vars, path) ??
        args.context.vars?.[path]
      return String(v ?? '') === String(cfg.value ?? '')
    }
    default:
      return false
  }
}

function waitMs(cfg: WaitStepConfig): number {
  const unitMs = cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000
  return Math.max(1_000, cfg.amount * unitMs)
}

function tpl(s: string, args: ExecuteArgs): string {
  return interpolateTemplate(s, args.context, { contact: args.contact })
}

function interpolateHeaders(
  headers: Record<string, string> | undefined,
  args: ExecuteArgs,
): Record<string, string> {
  if (!headers) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = tpl(v, args)
  }
  return out
}

function isCustomerLookupUrl(url: string): boolean {
  return url.includes('bookings/customer')
}

function isBookingCreateUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname
    return /\/bookings\/?$/i.test(path) && !path.includes('/customer')
  } catch {
    return url.includes('/bookings') && !url.includes('/customer')
  }
}

async function notifyBookingFailure(args: ExecuteArgs, errMsg: string): Promise<void> {
  if (!args.contactId) return
  try {
    const conversationId =
      args.context.conversation_id ?? (await resolveConversationId(args))
    await engineSendText({
      userId: args.automation.user_id,
      conversationId,
      contactId: args.contactId,
      text: `We couldn't complete your pickup booking: ${errMsg}. Please check the date (YYYY-MM-DD) and time slot, then try again.`,
      inboundMessageId: args.context.inbound_message_id,
    })
  } catch (e) {
    console.warn('[automations] booking failure notify:', e)
  }
}

/** 404 or API "not found" payloads → treat as no existing customer (run condition No branch). */
function isCustomerNotFoundResponse(status: number, data: unknown): boolean {
  if (status === 404) return true
  if (status !== 400 && status !== 422) return false
  if (!data || typeof data !== 'object') return false
  const msg = String(
    (data as Record<string, unknown>).error ??
      (data as Record<string, unknown>).message ??
      '',
  ).toLowerCase()
  return msg.includes('not found') || msg.includes('no customer')
}

function applyCustomerLookupMiss(
  vars: Record<string, unknown>,
  storeAs: string,
  data: unknown,
): void {
  vars[storeAs] = data
  vars.customer_found = false
  delete vars.customer
  delete vars.customer_name
  delete vars.customer_locality
  delete vars.customer_address
  delete vars.customer_phone
}

function httpErrorMessage(data: unknown, rawText: string, status: number): string {
  if (typeof data === 'object' && data !== null) {
    const row = data as Record<string, unknown>
    if (row.error != null) return String(row.error)
    if (row.message != null) return String(row.message)
  }
  return rawText || `HTTP ${status}`
}

function applyCustomerLookupToVars(
  vars: Record<string, unknown>,
  storeAs: string,
  data: unknown,
): void {
  vars[storeAs] = data
  const { found, customer } = parseCustomerLookupResult(data)
  vars.customer_found = found
  if (customer) {
    vars.customer = customer
    vars.customer_name = customer.name ?? ''
    vars.customer_locality = customer.locality ?? ''
    vars.customer_address = customer.pickupAddress ?? ''
    if (customer.phonePrimary) vars.customer_phone = customer.phonePrimary
  } else {
    delete vars.customer
    delete vars.customer_name
    delete vars.customer_locality
    delete vars.customer_address
    delete vars.customer_phone
  }
}

function applyHttpResponseToVars(
  url: string,
  data: unknown,
  vars: Record<string, unknown>,
  storeAs: string,
): void {
  vars[storeAs] = data
  if (!isCustomerLookupUrl(url)) return
  applyCustomerLookupToVars(vars, storeAs, data)
}

async function loadContactForAutomation(
  userId: string,
  contactId: string,
): Promise<{ name?: string | null; phone?: string | null; email?: string | null } | undefined> {
  const { data } = await supabaseAdmin()
    .from('contacts')
    .select('name, phone, email')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return undefined
  return { name: data.name, phone: data.phone, email: data.email }
}

/** Used by send_message and other steps that still call interpolate() */
function interpolate(s: string, args: ExecuteArgs): string {
  return tpl(s, args)
}

async function appendResults(
  logId: string | null,
  newItems: AutomationLogStepResult[],
  status: 'success' | 'partial' | 'failed' | null,
  errorMessage: string | null,
) {
  if (!logId) return
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('automation_logs')
    .select('steps_executed, status')
    .eq('id', logId)
    .single()
  const merged = [
    ...((existing?.steps_executed as AutomationLogStepResult[] | undefined) ?? []),
    ...newItems,
  ]
  const update: Record<string, unknown> = { steps_executed: merged }
  // Only overwrite status on the outermost scope — nested branches pass null.
  if (status !== null) {
    update.status = status
  }
  if (errorMessage) update.error_message = errorMessage
  await db.from('automation_logs').update(update).eq('id', logId)
}

async function finalizeLog(
  logId: string | null,
  status: 'success' | 'partial' | 'failed',
  errorMessage: string | null,
) {
  if (!logId) return
  await supabaseAdmin()
    .from('automation_logs')
    .update({ status, error_message: errorMessage })
    .eq('id', logId)
}

async function markPending(id: string, status: 'done' | 'failed') {
  await supabaseAdmin()
    .from('automation_pending_executions')
    .update({ status })
    .eq('id', id)
}
