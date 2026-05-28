import type { AutomationStep } from '@/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getAllAutomationSteps } from '@/lib/automations/automation-cache'
import { cacheGet, cacheGetMany, cacheSet } from '@/lib/redis/cache'
import { isRedisEnabled } from '@/lib/redis/client'

const WA_CONFIG_TTL_SEC = 300

export interface CachedWhatsAppConfig {
  phone_number_id: string
  access_token: string
  waba_id: string | null
}

function waConfigKey(userId: string): string {
  return `wa:config:${userId}`
}

export async function getWhatsAppConfigCached(
  userId: string,
): Promise<CachedWhatsAppConfig | null> {
  const key = waConfigKey(userId)
  const cached = await cacheGet<CachedWhatsAppConfig>(key)
  if (cached?.phone_number_id && cached.access_token) return cached

  const { data: config, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('phone_number_id, access_token, waba_id')
    .eq('user_id', userId)
    .single()

  if (error || !config) return null

  const row: CachedWhatsAppConfig = {
    phone_number_id: config.phone_number_id as string,
    access_token: decrypt(config.access_token as string),
    waba_id: (config.waba_id as string | null) ?? null,
  }

  await cacheSet(key, row, WA_CONFIG_TTL_SEC)
  return row
}

/** Typing pause before automation replies (ms). Shorter when Redis fast-path is on. */
export function automationTypingDelayMs(): number {
  const fromEnv = process.env.AUTOMATION_TYPING_DELAY_MS?.trim()
  if (fromEnv) {
    const n = Number(fromEnv)
    if (!Number.isNaN(n) && n >= 0) return n
  }
  if (process.env.AUTOMATION_FAST_MODE === 'true') return 0
  if (isRedisEnabled()) return 100
  return 1200
}

function stepsCacheKey(automationId: string): string {
  return `automation:steps:${automationId}`
}

/** One Redis pipeline for WhatsApp config + automation steps (resume hot path). */
export async function prefetchAutomationRuntime(
  userId: string,
  automationId: string,
): Promise<{
  whatsappConfig: CachedWhatsAppConfig | null
  allSteps: AutomationStep[]
}> {
  if (!isRedisEnabled()) {
    return { whatsappConfig: null, allSteps: [] }
  }

  const [waCached, stepsCached] = await cacheGetMany<
    CachedWhatsAppConfig | AutomationStep[]
  >([waConfigKey(userId), stepsCacheKey(automationId)])

  let whatsappConfig = waCached as CachedWhatsAppConfig | null
  if (!whatsappConfig?.phone_number_id || !whatsappConfig.access_token) {
    whatsappConfig = await getWhatsAppConfigCached(userId)
  }

  const stepsHit = stepsCached as AutomationStep[] | null
  const allSteps =
    stepsHit?.length ? stepsHit : await getAllAutomationSteps(automationId)

  return { whatsappConfig, allSteps }
}

export async function invalidateWhatsAppConfigCache(userId: string): Promise<void> {
  const { cacheDel } = await import('@/lib/redis/cache')
  await cacheDel(waConfigKey(userId))
}

export interface AutomationRuntime {
  whatsappConfig?: CachedWhatsAppConfig | null
  /** Only the first outbound message in a run shows typing (faster multi-step flows). */
  typingShown?: boolean
  allSteps?: import('@/types').AutomationStep[]
}
