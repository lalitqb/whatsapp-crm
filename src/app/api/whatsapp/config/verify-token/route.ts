import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/whatsapp/encryption'
import { generateWebhookVerifyToken } from '@/lib/whatsapp/verify-token'

/**
 * POST /api/whatsapp/config/verify-token
 *
 * Generates a cryptographically random webhook verify token, encrypts it,
 * and stores it on the user's existing whatsapp_config row.
 */
export async function POST() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (fetchError) {
      console.error('[verify-token] fetch failed:', fetchError)
      return NextResponse.json(
        { error: 'Failed to load configuration' },
        { status: 500 },
      )
    }

    if (!existing) {
      return NextResponse.json(
        {
          error:
            'Save your API credentials first, then generate a verify token.',
        },
        { status: 400 },
      )
    }

    const verifyToken = generateWebhookVerifyToken()

    let encryptedVerifyToken: string
    try {
      encryptedVerifyToken = encrypt(verifyToken)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('[verify-token] encryption failed:', message)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 },
      )
    }

    const { error: updateError } = await supabase
      .from('whatsapp_config')
      .update({
        verify_token: encryptedVerifyToken,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[verify-token] update failed:', updateError)
      return NextResponse.json(
        { error: 'Failed to save verify token' },
        { status: 500 },
      )
    }

    return NextResponse.json({ verify_token: verifyToken })
  } catch (error) {
    console.error('[verify-token] unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
