/**
 * Verbose webhook logging for local debugging.
 *
 * Enabled when:
 *   - NODE_ENV is `development`, or
 *   - WEBHOOK_VERBOSE_LOGS=true in .env.local
 *
 * Never logs verify tokens, access tokens, or full HMAC signatures.
 */

export function isWebhookVerbose(): boolean {
  if (process.env.WEBHOOK_VERBOSE_LOGS === 'true') return true
  if (process.env.WEBHOOK_VERBOSE_LOGS === 'false') return false
  return process.env.NODE_ENV === 'development'
}

function prefix(): string {
  return `[webhook ${new Date().toISOString()}]`
}

export function logWebhook(message: string, data?: unknown): void {
  if (!isWebhookVerbose()) return
  if (data === undefined) {
    console.log(`${prefix()} ${message}`)
    return
  }
  if (typeof data === 'string') {
    console.log(`${prefix()} ${message}\n${data}`)
    return
  }
  console.log(`${prefix()} ${message}`, JSON.stringify(data, null, 2))
}

export function logWebhookRawJson(message: string, json: string): void {
  if (!isWebhookVerbose()) return
  console.log(`${prefix()} ${message}\n${json}`)
}

export function logWebhookError(message: string, err: unknown): void {
  const detail =
    err instanceof Error ? err.message : typeof err === 'string' ? err : err
  console.error(`${prefix()} ${message}`, detail)
}
