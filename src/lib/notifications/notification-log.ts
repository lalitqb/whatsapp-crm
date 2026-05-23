import { createClient } from '@supabase/supabase-js'
import { isValidStatusTransition } from '@/lib/whatsapp/status-transitions'

export type NotificationLogStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'

export interface NotificationLogInput {
  userId: string
  customerPhone: string
  templateName: string
  templateLanguage?: string
  variables?: Record<string, string>
  variableOrder?: string[]
  requestPayload?: Record<string, unknown>
}

export interface MetaStatusError {
  code?: number
  title?: string
  message?: string
  error_data?: { details?: string }
}

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function createNotificationLog(
  input: NotificationLogInput,
): Promise<string | null> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('notification_logs')
    .insert({
      user_id: input.userId,
      customer_phone: input.customerPhone,
      template_name: input.templateName,
      template_language: input.templateLanguage ?? null,
      variables: input.variables ?? {},
      variable_order: input.variableOrder ?? null,
      request_payload: input.requestPayload ?? null,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[notification-log] create failed:', error.message)
    return null
  }
  return data.id
}

export async function markNotificationLogSent(
  logId: string,
  params: {
    whatsappMessageId: string
    phone: string
    templateLanguage: string
  },
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin()
    .from('notification_logs')
    .update({
      status: 'sent',
      whatsapp_message_id: params.whatsappMessageId,
      customer_phone: params.phone,
      template_language: params.templateLanguage,
      sent_at: now,
    })
    .eq('id', logId)

  if (error) {
    console.error('[notification-log] mark sent failed:', error.message)
  }
}

export async function markNotificationLogFailed(
  logId: string,
  apiError: string,
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin()
    .from('notification_logs')
    .update({
      status: 'failed',
      api_error: apiError,
      failed_at: now,
    })
    .eq('id', logId)

  if (error) {
    console.error('[notification-log] mark failed failed:', error.message)
  }
}

export async function applyMetaStatusToNotificationLog(status: {
  id: string
  status: string
  timestamp: string
  errors?: MetaStatusError[]
  recipient_id?: string
}): Promise<void> {
  const { data: log, error: fetchErr } = await supabaseAdmin()
    .from('notification_logs')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle()

  if (fetchErr) {
    console.error('[notification-log] fetch by wamid:', fetchErr.message)
    return
  }
  if (!log) return

  if (!isValidStatusTransition(log.status, status.status)) return

  const tsIso = new Date(parseInt(status.timestamp, 10) * 1000).toISOString()
  const update: Record<string, unknown> = {
    status: status.status,
    meta_status_payload: status,
  }

  if (status.status === 'sent') update.sent_at = tsIso
  if (status.status === 'delivered') update.delivered_at = tsIso
  if (status.status === 'read') update.read_at = tsIso
  if (status.status === 'failed') {
    update.failed_at = tsIso
    const err = status.errors?.[0]
    if (err) {
      update.meta_error_code = err.code != null ? String(err.code) : null
      update.meta_error_title = err.title ?? null
      update.meta_error_message = err.message ?? null
      update.meta_error_details = err.error_data?.details ?? null
    }
  }

  const { error: updateErr } = await supabaseAdmin()
    .from('notification_logs')
    .update(update)
    .eq('id', log.id)

  if (updateErr) {
    console.error('[notification-log] webhook update:', updateErr.message)
  }
}
