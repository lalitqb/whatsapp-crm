import { describe, expect, it } from 'vitest'
import { userIdFromAuthCookies } from './request-auth'

describe('userIdFromAuthCookies', () => {
  it('extracts sub from access_token in auth cookie JSON', () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user-abc-123', role: 'authenticated' }),
    ).toString('base64url')
    const accessToken = `header.${payload}.sig`
    const session = JSON.stringify({ access_token: accessToken })
    const encoded = `base64-${Buffer.from(session).toString('base64url')}`

    const userId = userIdFromAuthCookies([
      { name: 'sb-test-auth-token', value: encoded },
    ])
    expect(userId).toBe('user-abc-123')
  })

  it('returns null when no auth cookies', () => {
    expect(userIdFromAuthCookies([{ name: 'other', value: 'x' }])).toBeNull()
  })
})
