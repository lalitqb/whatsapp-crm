import { describe, expect, it } from 'vitest'
import { generateWebhookVerifyToken } from './verify-token'

describe('generateWebhookVerifyToken', () => {
  it('returns a non-empty base64url string', () => {
    const token = generateWebhookVerifyToken()
    expect(token.length).toBeGreaterThan(20)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('generates unique values', () => {
    const a = generateWebhookVerifyToken()
    const b = generateWebhookVerifyToken()
    expect(a).not.toBe(b)
  })
})
