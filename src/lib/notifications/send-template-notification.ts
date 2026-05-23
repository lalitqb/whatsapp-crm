import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import {
  isValidE164,
  phoneVariants,
  preparePhoneForMeta,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { resolveTemplateForSend } from '@/lib/notifications/resolve-template'
import { fetchMetaTemplateByName } from '@/lib/whatsapp/fetch-meta-template'
import { normalizeMetaLanguageCode } from '@/lib/whatsapp/template-meta'
import {
  buildTemplateSendPlanFromSources,
  type HeaderMediaInput,
} from '@/lib/whatsapp/template-send-plan'
import { headerTypeToMediaType } from '@/lib/whatsapp/template-header-media'
import { markNotificationLogSent } from '@/lib/notifications/notification-log'

export interface SendTemplateNotificationInput {
  userId: string
  customerPhone: string
  templateName: string
  variables?: Record<string, string>
  variableOrder?: string[]
  language?: string
  /** Image/video/document header — public HTTPS URL required by Meta */
  headerMedia?: HeaderMediaInput | null
  /** Row in notification_logs created before send */
  logId?: string | null
}

export interface SendTemplateNotificationResult {
  success: true
  messageId: string
  phone: string
  template: string
  language: string
  logId?: string | null
}

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function sendTemplateNotification(
  input: SendTemplateNotificationInput,
): Promise<SendTemplateNotificationResult> {
  const {
    userId,
    customerPhone,
    templateName,
    variables = {},
    variableOrder,
    language: languageOverride,
    headerMedia,
  } = input

  const preparedPhone = preparePhoneForMeta(customerPhone)
  if (!isValidE164(preparedPhone)) {
    throw new Error(
      'Invalid customerPhone. Use international format (e.g. 917903949014 or +91 7903949014).',
    )
  }

  const db = supabaseAdmin()

  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (configError || !config) {
    throw new Error('WhatsApp is not configured for this account.')
  }

  const lang = languageOverride?.trim()
    ? normalizeMetaLanguageCode(languageOverride.trim())
    : undefined

  if (!config.waba_id) {
    throw new Error('WABA ID missing in WhatsApp config.')
  }

  const accessToken = decrypt(config.access_token)

  const template = await resolveTemplateForSend(db, {
    userId,
    templateName,
    language: lang,
    wabaId: config.waba_id,
    accessToken,
  })

  if (template.status !== 'Approved') {
    throw new Error(
      `Template "${templateName}" is not approved on Meta (status: ${template.status ?? 'unknown'}).`,
    )
  }

  const mapping = template.variable_mapping as
    | Record<string, number | string>
    | null
    | undefined

  const metaTemplate = await fetchMetaTemplateByName({
    wabaId: config.waba_id,
    accessToken,
    name: template.name,
    language: lang || template.language,
  })

  const language = normalizeMetaLanguageCode(
    lang || metaTemplate?.language || template.language || 'en_US',
  )

  const storedHeaderMedia: HeaderMediaInput | null =
    !headerMedia && template.header_media_url
      ? {
          url: template.header_media_url,
          type: headerTypeToMediaType(template.header_type),
          filename: template.header_media_filename ?? undefined,
        }
      : null

  const sendPlan = buildTemplateSendPlanFromSources(
    metaTemplate
      ? {
          body_text: metaTemplate.body_text,
          components: metaTemplate.components,
          parameter_format: metaTemplate.parameter_format,
        }
      : null,
    { body_text: template.body_text },
    variables,
    {
      mapping,
      variableOrder,
      headerMedia: headerMedia ?? storedHeaderMedia,
    },
  )

  const bodyParameters = sendPlan.bodyParameters
  const buttonParameters = sendPlan.buttonParameters
  const headerMediaParam = sendPlan.headerMedia

  const variants = phoneVariants(preparedPhone)
  let messageId: string | null = null
  let workingPhone = preparedPhone
  let lastError: string | null = null

  for (const variant of variants) {
    try {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: variant,
        templateName: template.name,
        language,
        bodyParameters,
        buttonParameters:
          buttonParameters.length > 0 ? buttonParameters : undefined,
        headerMedia: headerMediaParam,
      })
      messageId = result.messageId
      workingPhone = variant
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown Meta API error'
      if (!isRecipientNotAllowedError(msg)) {
        throw new Error(msg)
      }
      lastError = msg
    }
  }

  if (!messageId) {
    throw new Error(lastError ?? 'Failed to send notification')
  }

  if (input.logId) {
    await markNotificationLogSent(input.logId, {
      whatsappMessageId: messageId,
      phone: workingPhone,
      templateLanguage: language,
    })
  }

  return {
    success: true,
    messageId,
    phone: workingPhone,
    template: template.name,
    language,
    logId: input.logId ?? null,
  }
}
