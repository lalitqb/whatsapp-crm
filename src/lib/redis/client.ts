import { Redis } from '@upstash/redis'

let client: Redis | null | undefined

/** True when Upstash REST credentials are configured. */
export function isRedisEnabled(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  )
}

/** Shared Upstash Redis client (REST). Returns null when not configured. */
export function getRedis(): Redis | null {
  if (client !== undefined) return client
  if (!isRedisEnabled()) {
    client = null
    return null
  }
  client = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
  return client
}
