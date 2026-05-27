import {
  sendTextMessage,
  sendTemplateMessage,
  sendTypingIndicator,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  preparePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { loadBroadcastTemplateContext } from '@/lib/whatsapp/broadcast-template-send'
import { normalizeMetaLanguageCode } from '@/lib/whatsapp/template-meta'
import {
  broadcastParamsToVariables,
  buildTemplateSendPlanFromSources,
} from '@/lib/whatsapp/template-send-plan'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Automation-side Meta sender.
//
// Mirrors the logic in src/app/api/whatsapp/send/route.ts but uses
// the service-role client (engine has no cookies) and accepts the
// user / conversation / contact identifiers the engine already has
// on hand. Kept here (rather than refactoring the user-facing send
// route) to avoid risk to the working manual-send path — they can
// converge in a later refactor.
// ------------------------------------------------------------

interface SendTextArgs {
  userId: string
  conversationId: string
  contactId: string
  text: string
  inboundMessageId?: string
}

interface SendTemplateArgs {
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  /** Positional values in {{1}}, {{2}} order (legacy). */
  params?: string[]
  /** Named or positional keys from automation step_config.variables. */
  variables?: Record<string, string | number>
  inboundMessageId?: string
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'template' })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaMeta(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Scope the contact lookup by user_id. The engine uses the
  // service-role client (bypassing RLS), and the public
  // /api/automations/engine endpoint accepts contact_id from the
  // request body — without this filter, an authenticated user could
  // fire their own automations against another tenant's contact UUID
  // and send via their own WhatsApp config to that contact's phone.
  // Practical risk is low (UUIDs are unguessable) but the check is
  // cheap defense-in-depth.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('user_id', input.userId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this user')
  }

  const sanitized = preparePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('user_id', input.userId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.access_token)

  if (input.inboundMessageId) {
    try {
      await sendTypingIndicator({
        phoneNumberId: config.phone_number_id,
        accessToken,
        messageId: input.inboundMessageId,
      })
    } catch (err) {
      // Typing indicator is best-effort; never block the actual automation reply.
      console.warn('[automations] typing indicator failed:', err)
    }
  }

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      const language = normalizeMetaLanguageCode(input.language ?? 'en_US')
      const ctx = await loadBroadcastTemplateContext(db, {
        userId: input.userId,
        templateName: input.templateName,
        templateLanguage: language,
        wabaId: config.waba_id ?? null,
        accessToken,
      })

      let variables: Record<string, string> = {}
      if (input.variables && Object.keys(input.variables).length > 0) {
        variables = Object.fromEntries(
          Object.entries(input.variables).map(([k, v]) => [k, String(v)]),
        )
      } else if (input.params?.length) {
        variables = broadcastParamsToVariables(
          input.params,
          ctx.bodyText,
          ctx.meta?.components,
          ctx.meta?.parameter_format,
        )
      }

      const sendPlan = buildTemplateSendPlanFromSources(
        ctx.meta,
        { body_text: ctx.bodyText },
        variables,
        { headerMedia: ctx.storedHeaderMedia },
      )

      const r = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: ctx.templateName,
        language: ctx.language,
        bodyParameters: sendPlan.bodyParameters,
        buttonParameters:
          sendPlan.buttonParameters.length > 0
            ? sendPlan.buttonParameters
            : undefined,
        headerMedia: sendPlan.headerMedia,
      })
      return r.messageId
    }
    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: input.text,
    })
    return r.messageId
  }

  // Same phone-variant retry as /api/whatsapp/send — Meta sandbox and
  // numbers registered with/without a trunk 0 both require this to
  // reliably land a message.
  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  // Persist the sent message so it appears in the inbox with a real
  // Meta message id. sender_type='bot' distinguishes automation sends
  // from manual agent sends.
  const content_type = input.kind === 'template' ? 'template' : 'text'
  const content_text = input.kind === 'text' ? input.text : null
  const template_name = input.kind === 'template' ? input.templateName : null

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type,
    content_text,
    template_name,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    // Meta already has the message; record the DB error but don't pretend
    // the send failed. The engine wraps this in a log line.
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text:
        input.kind === 'template' ? `[template:${input.templateName}]` : input.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
