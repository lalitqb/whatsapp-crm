import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  preparePhoneForMeta,
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  buildBroadcastRecipientSendPlan,
  loadBroadcastTemplateContext,
} from '@/lib/whatsapp/broadcast-template-send'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

interface NewRecipient {
  phone: string
  params?: string[]
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
    } = body

    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 },
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)

    let templateCtx
    try {
      templateCtx = await loadBroadcastTemplateContext(supabase, {
        userId: user.id,
        templateName: template_name,
        templateLanguage: template_language,
        wabaId: config.waba_id,
        accessToken,
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load template'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    if (!templateCtx.bodyText) {
      return NextResponse.json(
        {
          error: `Template "${template_name}" not found. Sync from Meta in Settings → Templates.`,
        },
        { status: 400 },
      )
    }

    // Fail fast before sending thousands of messages with a bad config.
    try {
      buildBroadcastRecipientSendPlan(templateCtx, recipients[0]?.params ?? [])
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Invalid template configuration'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      const prepared = preparePhoneForMeta(recipient.phone)

      if (!isValidE164(prepared)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error:
            'Invalid phone number. Use international format (e.g. +91 7903949014 or 917903949014)',
        })
        failedCount++
        continue
      }

      if (prepared !== sanitizePhoneForMeta(recipient.phone)) {
        console.info(
          `[broadcast] normalized ${recipient.phone} → ${prepared} for Meta`,
        )
      }

      let sendPlan
      try {
        sendPlan = buildBroadcastRecipientSendPlan(
          templateCtx,
          recipient.params ?? [],
        )
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Template parameter error'
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: errorMessage,
        })
        failedCount++
        continue
      }

      const variants = phoneVariants(prepared)
      let sentMessageId: string | null = null
      let lastError: string | null = null

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: template_name,
            language: templateCtx.language,
            bodyParameters: sendPlan.bodyParameters,
            buttonParameters:
              sendPlan.buttonParameters.length > 0
                ? sendPlan.buttonParameters
                : undefined,
            headerMedia: sendPlan.headerMedia,
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            break
          }
          lastError = errorMessage
        }
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError,
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 },
    )
  }
}
