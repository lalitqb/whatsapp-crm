import { timingSafeEqual } from 'crypto'

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export function getNotificationApiKeyFromRequest(request: Request): string | null {
  const bearer = request.headers.get('authorization')
  if (bearer?.startsWith('Bearer ')) {
    return bearer.slice(7).trim()
  }
  const header = request.headers.get('x-api-key')
  if (header) return header.trim()
  return null
}

export function verifyNotificationApiKey(request: Request): boolean {
  const expected = process.env.NOTIFICATION_API_KEY?.trim()
  if (!expected) return false
  const provided = getNotificationApiKeyFromRequest(request)
  if (!provided) return false
  return safeEqual(provided, expected)
}

export function getNotificationApiUserId(): string | null {
  const id = process.env.NOTIFICATION_API_USER_ID?.trim()
  return id || null
}
