import { getRedis, isRedisEnabled } from '@/lib/redis/client'

const DEFAULT_TTL_SEC = 300

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const value = await redis.get<T>(key)
    return value ?? null
  } catch (err) {
    console.warn('[redis] cacheGet failed:', key, err)
    return null
  }
}

/** Fetch multiple keys in one Upstash HTTP round-trip (much faster than serial GETs). */
export async function cacheGetMany<T>(keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return []
  const redis = getRedis()
  if (!redis) return keys.map(() => null)
  try {
    const pipe = redis.pipeline()
    for (const key of keys) pipe.get(key)
    const results = await pipe.exec()
    return results.map((v) => (v ?? null) as T | null)
  } catch (err) {
    console.warn('[redis] cacheGetMany failed:', err)
    return keys.map(() => null)
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(key, value, { ex: ttlSec })
  } catch (err) {
    console.warn('[redis] cacheSet failed:', key, err)
  }
}

export async function cacheDel(key: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.del(key)
  } catch (err) {
    console.warn('[redis] cacheDel failed:', key, err)
  }
}

export async function cacheDelMany(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.del(...keys)
  } catch (err) {
    console.warn('[redis] cacheDelMany failed:', err)
  }
}

export { isRedisEnabled }
