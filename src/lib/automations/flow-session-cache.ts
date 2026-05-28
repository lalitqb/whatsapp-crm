import type { FlowSessionRow } from '@/lib/automations/flow-session-store'
import { cacheDel, cacheGet, cacheSet } from '@/lib/redis/cache'

const FLOW_TTL_SEC = 86400

export function flowSessionRedisKey(userId: string, contactId: string): string {
  return `flow:${userId}:${contactId}`
}

function flowKey(userId: string, contactId: string): string {
  return flowSessionRedisKey(userId, contactId)
}

export async function getFlowSessionFromRedis(
  userId: string,
  contactId: string,
): Promise<FlowSessionRow | null> {
  return cacheGet<FlowSessionRow>(flowKey(userId, contactId))
}

export async function setFlowSessionInRedis(
  userId: string,
  contactId: string,
  session: FlowSessionRow,
): Promise<void> {
  await cacheSet(flowKey(userId, contactId), session, FLOW_TTL_SEC)
}

export async function clearFlowSessionInRedis(
  userId: string,
  contactId: string,
): Promise<void> {
  await cacheDel(flowKey(userId, contactId))
}
