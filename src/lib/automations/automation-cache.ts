import type { Automation, AutomationStep, AutomationTriggerType } from '@/types'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { cacheDel, cacheDelMany, cacheGet, cacheSet } from '@/lib/redis/cache'

const STEPS_TTL_SEC = 600
const AUTOMATIONS_TTL_SEC = 120

function stepsKey(automationId: string): string {
  return `automation:steps:${automationId}`
}

function activeAutomationsKey(userId: string, triggerType: AutomationTriggerType): string {
  return `automations:active:${userId}:${triggerType}`
}

export async function getAllAutomationSteps(automationId: string): Promise<AutomationStep[]> {
  const cached = await cacheGet<AutomationStep[]>(stepsKey(automationId))
  if (cached?.length) return cached

  const { data, error } = await supabaseAdmin()
    .from('automation_steps')
    .select('*')
    .eq('automation_id', automationId)
    .order('position', { ascending: true })

  if (error) {
    console.error('[automation-cache] load steps failed:', error.message)
    return []
  }

  const steps = (data ?? []) as AutomationStep[]
  if (steps.length > 0) {
    await cacheSet(stepsKey(automationId), steps, STEPS_TTL_SEC)
  }
  return steps
}

export function filterAutomationSteps(
  allSteps: AutomationStep[],
  parentStepId: string | null,
  branch: 'yes' | 'no' | null,
  startPosition: number,
): AutomationStep[] {
  return allSteps
    .filter((step) => {
      if (parentStepId === null) {
        return step.parent_step_id == null
      }
      return (
        step.parent_step_id === parentStepId &&
        (step.branch ?? 'yes') === (branch ?? 'yes')
      )
    })
    .filter((step) => step.position >= startPosition)
    .sort((a, b) => a.position - b.position)
}

export async function getActiveAutomationsCached(
  userId: string,
  triggerType: AutomationTriggerType,
): Promise<Automation[]> {
  const key = activeAutomationsKey(userId, triggerType)
  const cached = await cacheGet<Automation[]>(key)
  if (cached) return cached

  const { data, error } = await supabaseAdmin()
    .from('automations')
    .select('*')
    .eq('user_id', userId)
    .eq('trigger_type', triggerType)
    .eq('is_active', true)

  if (error) {
    console.error('[automation-cache] load automations failed:', error.message)
    return []
  }

  const automations = (data ?? []) as Automation[]
  await cacheSet(key, automations, AUTOMATIONS_TTL_SEC)
  return automations
}

export async function invalidateAutomationCache(
  userId: string,
  automationId?: string,
): Promise<void> {
  const triggerTypes: AutomationTriggerType[] = [
    'new_message_received',
    'first_inbound_message',
    'keyword_match',
    'new_contact_created',
    'conversation_assigned',
    'tag_added',
    'time_based',
  ]
  const keys = triggerTypes.map((t) => activeAutomationsKey(userId, t))
  if (automationId) keys.push(stepsKey(automationId))
  await cacheDelMany(keys)
}
