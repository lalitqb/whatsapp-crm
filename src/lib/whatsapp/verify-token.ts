import crypto from 'crypto'

/** URL-safe random string for Meta webhook `hub.verify_token` verification. */
export function generateWebhookVerifyToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}
