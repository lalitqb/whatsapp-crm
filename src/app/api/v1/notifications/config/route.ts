import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getNotificationApiUserId } from '@/lib/notifications/api-auth'

/**
 * GET /api/v1/notifications/config
 *
 * Logged-in CRM users only. Returns integration status for the Settings UI.
 * Never returns the full NOTIFICATION_API_KEY.
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

  const configuredUserId = getNotificationApiUserId()
  const apiKeyConfigured = Boolean(process.env.NOTIFICATION_API_KEY?.trim())

  const { data: waConfig } = await supabase
    .from('whatsapp_config')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  const origin = new URL(request.url).origin

  return NextResponse.json({
    endpoint: `${origin}/api/v1/notifications/send`,
    /** Logged-in CRM account — use this value for NOTIFICATION_API_USER_ID */
    currentUserId: user.id,
    apiKeyConfigured,
    userIdConfigured: Boolean(configuredUserId),
    userIdMatchesSession:
      Boolean(configuredUserId) && configuredUserId === user.id,
    whatsappConfigured: Boolean(waConfig),
    envVars: {
      apiKey: 'NOTIFICATION_API_KEY',
      userId: 'NOTIFICATION_API_USER_ID',
    },
  })
}
