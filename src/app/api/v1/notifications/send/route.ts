import { NextResponse } from 'next/server'
import {
  getNotificationApiUserId,
  verifyNotificationApiKey,
} from '@/lib/notifications/api-auth'
import { sendTemplateNotification } from '@/lib/notifications/send-template-notification'
import {
  createNotificationLog,
  markNotificationLogFailed,
} from '@/lib/notifications/notification-log'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

/**
 * POST /api/v1/notifications/send
 *
 * External systems (e.g. laundry app, order service) call this to send
 * a WhatsApp template notification. Not the same as Meta's inbound webhook.
 *
 * Auth: NOTIFICATION_API_KEY via header
 *   Authorization: Bearer <key>
 *   or X-API-Key: <key>
 *
 * Env:
 *   NOTIFICATION_API_KEY      — shared secret for integrators
 *   NOTIFICATION_API_USER_ID  — Supabase auth user id that owns whatsapp_config
 *
 * Example:
 * ```bash
 * curl -X POST https://your-domain.com/api/v1/notifications/send \
 *   -H "Authorization: Bearer $NOTIFICATION_API_KEY" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "customerPhone": "917903949014",
 *     "template": "laundry_order_ready",
 *     "variables": {
 *       "customer_name": "Lalit",
 *       "order_id": "LD1234"
 *     },
 *     "variableOrder": ["customer_name", "order_id"],
 *     "headerMedia": {
 *       "url": "https://emeraldwash.in/assets/pickup-banner.jpg",
 *       "type": "image"
 *     }
 *   }'
 * ```
 *
 * Templates with a media header: upload once in Settings → Templates, or
 * pass headerMedia.url / variables.header_image_url per request.
 *
 * Templates on Meta use {{1}}, {{2}} in the body. Map named variables via:
 *   - variableOrder in the request (see example), or
 *   - message_templates.variable_mapping in the DB, or
 *   - variables with keys "1", "2" matching slots
 */
export async function POST(request: Request) {
  if (!verifyNotificationApiKey(request)) {
    return NextResponse.json(
      {
        error:
          'Unauthorized. Provide NOTIFICATION_API_KEY as Bearer token or X-API-Key.',
      },
      { status: 401 },
    )
  }

  const userId = getNotificationApiUserId()
  if (!userId) {
    return NextResponse.json(
      {
        error:
          'Server misconfigured: NOTIFICATION_API_USER_ID is not set in environment.',
      },
      { status: 500 },
    )
  }

  const limit = checkRateLimit(
    `notification:${userId}`,
    RATE_LIMITS.notification,
  )
  if (!limit.success) {
    return rateLimitResponse(limit)
  }

  let body: {
    customerPhone?: string
    template?: string
    variables?: Record<string, string>
    variableOrder?: string[]
    language?: string
    headerMedia?: { url?: string; type?: string; filename?: string }
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.customerPhone?.trim()) {
    return NextResponse.json(
      { error: 'customerPhone is required' },
      { status: 400 },
    )
  }
  if (!body.template?.trim()) {
    return NextResponse.json({ error: 'template is required' }, { status: 400 })
  }

  const variables = body.variables ?? {}
  if (variables && typeof variables !== 'object') {
    return NextResponse.json(
      { error: 'variables must be an object' },
      { status: 400 },
    )
  }

  const customerPhone = body.customerPhone.trim()
  const templateName = body.template.trim()
  const normalizedVariables = Object.fromEntries(
    Object.entries(variables).map(([k, v]) => [k, String(v)]),
  )
  const variableOrder = Array.isArray(body.variableOrder)
    ? body.variableOrder
    : undefined
  const language = body.language?.trim()
  const headerMedia = body.headerMedia

  const logId = await createNotificationLog({
    userId,
    customerPhone,
    templateName,
    templateLanguage: language,
    variables: normalizedVariables,
    variableOrder,
    requestPayload: {
      customerPhone,
      template: templateName,
      variables: normalizedVariables,
      variableOrder,
      language,
      headerMedia,
    },
  })

  try {
    const result = await sendTemplateNotification({
      userId,
      customerPhone,
      templateName,
      variables: normalizedVariables,
      variableOrder,
      language,
      headerMedia,
      logId,
    })

    return NextResponse.json(result)
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to send notification'
    console.error('[notifications/send]', message)
    if (logId) {
      await markNotificationLogFailed(logId, message)
    }
    return NextResponse.json(
      { error: message, logId: logId ?? undefined },
      { status: 502 },
    )
  }
}
