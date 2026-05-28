import { NextResponse } from 'next/server'
import { getRedis, isRedisEnabled } from '@/lib/redis/client'

/** GET /api/health/redis — verify Upstash is configured and reachable. */
export async function GET() {
  if (!isRedisEnabled()) {
    return NextResponse.json({
      enabled: false,
      ok: false,
      message: 'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local',
    })
  }

  const redis = getRedis()
  if (!redis) {
    return NextResponse.json({ enabled: true, ok: false, message: 'Redis client failed to init' })
  }

  const key = 'wacrm:health'
  const t0 = Date.now()
  try {
    await redis.set(key, 'ok', { ex: 30 })
    const value = await redis.get<string>(key)
    const latencyMs = Date.now() - t0
    return NextResponse.json({
      enabled: true,
      ok: value === 'ok',
      latencyMs,
      message:
        latencyMs > 200
          ? 'Connected. Upstash REST adds ~200–400ms per round-trip; pipelining is used in automations.'
          : 'Connected',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ enabled: true, ok: false, message }, { status: 503 })
  }
}
