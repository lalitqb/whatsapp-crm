import type { User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getUserIdFromServerCookies, userIdFromAuthCookies } from '@/lib/supabase/request-auth'

export type ServerAuthResult =
  | { user: User; supabase: Awaited<ReturnType<typeof createClient>>; userId: string }
  | {
      user: null
      supabase: Awaited<ReturnType<typeof createClient>>
      userId: null
      error: string
      status: 401 | 503
    }

function minimalUser(userId: string, email?: string | null): User {
  return {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: email ?? undefined,
    app_metadata: {},
    user_metadata: {},
    created_at: '',
  } as User
}

/**
 * Resolve signed-in user for API routes. Tries cookie JWT first (no network),
 * then getSession() when needed.
 */
export async function getServerAuthUser(): Promise<ServerAuthResult> {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const allCookies = cookieStore.getAll()

  const userIdFromCookie = userIdFromAuthCookies(allCookies)
  if (userIdFromCookie) {
    return {
      user: minimalUser(userIdFromCookie),
      supabase,
      userId: userIdFromCookie,
    }
  }

  try {
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) {
      return {
        user: null,
        supabase,
        userId: null,
        error: error.message,
        status: 401,
      }
    }
    if (session?.user) {
      return { user: session.user, supabase, userId: session.user.id }
    }
    return {
      user: null,
      supabase,
      userId: null,
      error: 'Not signed in',
      status: 401,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isNetwork =
      msg.includes('fetch failed') ||
      msg.includes('Connect Timeout') ||
      msg.includes('UND_ERR_CONNECT_TIMEOUT')

    const fallbackId = await getUserIdFromServerCookies()
    if (fallbackId) {
      return {
        user: minimalUser(fallbackId),
        supabase,
        userId: fallbackId,
      }
    }

    return {
      user: null,
      supabase,
      userId: null,
      error: isNetwork
        ? 'Cannot reach Supabase Auth. Check your internet or NEXT_PUBLIC_SUPABASE_URL.'
        : msg,
      status: 503,
    }
  }
}
