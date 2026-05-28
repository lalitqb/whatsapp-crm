import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'

type CookieLike = { name: string; value: string }

/**
 * Read user id from Supabase auth cookies without calling Auth API.
 * Used when getSession/getUser would network-fail (timeouts).
 */
export function userIdFromAuthCookies(cookieList: CookieLike[]): string | null {
  const authCookies = cookieList.filter(
    (c) => c.name.includes('auth-token') && !c.name.endsWith('-user'),
  )

  for (const cookie of authCookies) {
    const userId = userIdFromAuthCookieValue(cookie.value)
    if (userId) return userId
  }

  return null
}

function userIdFromAuthCookieValue(value: string): string | null {
  try {
    let raw = value
    if (raw.startsWith('base64-')) {
      raw = Buffer.from(raw.slice(7), 'base64url').toString('utf8')
    }
    const parsed = JSON.parse(raw) as { access_token?: string }
    const token = parsed.access_token
    if (!token || token.split('.').length < 2) return null
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as { sub?: string }
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

export function userIdFromNextRequest(request: NextRequest): string | null {
  return userIdFromAuthCookies(request.cookies.getAll())
}

export async function getUserIdFromServerCookies(): Promise<string | null> {
  const store = await cookies()
  return userIdFromAuthCookies(store.getAll())
}

export function hasAuthCookie(cookieList: CookieLike[]): boolean {
  return cookieList.some((c) => c.name.includes('auth-token'))
}
