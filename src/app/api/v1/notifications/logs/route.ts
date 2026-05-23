import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/v1/notifications/logs
 *
 * Logged-in CRM users only. Lists notification API send attempts and
 * delivery status (updated from Meta webhooks).
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 1),
    100,
  )
  const status = searchParams.get('status')?.trim()

  let query = supabase
    .from('notification_logs')
    .select(
      'id, customer_phone, template_name, template_language, variables, variable_order, status, whatsapp_message_id, api_error, meta_error_code, meta_error_title, meta_error_message, meta_error_details, sent_at, delivered_at, read_at, failed_at, created_at, updated_at',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({
        logs: [],
        migrationRequired: true,
        message:
          'Run supabase/migrations/011_notification_logs.sql in the Supabase SQL Editor to enable logging.',
      })
    }
    console.error('[notifications/logs]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ logs: data ?? [] })
}
