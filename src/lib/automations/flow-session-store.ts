import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  clearFlowSessionInRedis,
  getFlowSessionFromRedis,
  setFlowSessionInRedis,
} from '@/lib/automations/flow-session-cache'
import { isRedisEnabled } from '@/lib/redis/client'

export interface FlowSessionRow {
  id: string
  user_id: string
  contact_id: string
  automation_id: string
  conversation_id: string | null
  log_id: string | null
  next_parent_step_id: string | null
  next_branch: 'yes' | 'no' | null
  next_position: number
  pending_reply_var: string | null
  vars: Record<string, unknown>
}

function rowFromDb(data: Record<string, unknown>): FlowSessionRow {
  return {
    id: data.id as string,
    user_id: data.user_id as string,
    contact_id: data.contact_id as string,
    automation_id: data.automation_id as string,
    conversation_id: (data.conversation_id as string | null) ?? null,
    log_id: (data.log_id as string | null) ?? null,
    next_parent_step_id: (data.next_parent_step_id as string | null) ?? null,
    next_branch: (data.next_branch as 'yes' | 'no' | null) ?? null,
    next_position: data.next_position as number,
    pending_reply_var: (data.pending_reply_var as string | null) ?? null,
    vars: (data.vars as Record<string, unknown>) ?? {},
  }
}

export async function getActiveFlowSession(
  userId: string,
  contactId: string,
): Promise<FlowSessionRow | null> {
  if (isRedisEnabled()) {
    const cached = await getFlowSessionFromRedis(userId, contactId)
    if (cached) return cached
  }

  const { data, error } = await supabaseAdmin()
    .from('automation_flow_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error?.code === '42P01') return null
  if (error) {
    console.error('[flow-session] load failed:', error.message)
    return null
  }
  if (!data) return null

  const row = rowFromDb(data as Record<string, unknown>)
  await setFlowSessionInRedis(userId, contactId, row)
  return row
}

export async function saveFlowSession(
  row: Omit<FlowSessionRow, 'user_id' | 'id'> & { userId: string; id?: string },
): Promise<void> {
  const payload = {
    user_id: row.userId,
    contact_id: row.contact_id,
    automation_id: row.automation_id,
    conversation_id: row.conversation_id,
    log_id: row.log_id,
    next_parent_step_id: row.next_parent_step_id,
    next_branch: row.next_branch,
    next_position: row.next_position,
    pending_reply_var: row.pending_reply_var,
    vars: row.vars,
    updated_at: new Date().toISOString(),
  }

  const redisRow: FlowSessionRow = {
    id: row.id ?? `redis-${row.automation_id}`,
    user_id: row.userId,
    contact_id: row.contact_id,
    automation_id: row.automation_id,
    conversation_id: row.conversation_id,
    log_id: row.log_id,
    next_parent_step_id: row.next_parent_step_id,
    next_branch: row.next_branch,
    next_position: row.next_position,
    pending_reply_var: row.pending_reply_var,
    vars: row.vars,
  }
  await setFlowSessionInRedis(row.userId, row.contact_id, redisRow)

  // Redis is the hot path for the next inbound message; persist to Postgres without
  // blocking the automation reply (saves ~100–300ms on wait_for_reply steps).
  void supabaseAdmin()
    .from('automation_flow_sessions')
    .upsert(payload, { onConflict: 'user_id,contact_id,automation_id' })
    .then(({ error }) => {
      if (!error) return
      if (error.code === '42P01' || error.message?.includes('automation_flow_sessions')) {
        console.error(
          '[flow-session] save failed: run supabase/migrations/015_automation_flow_sessions.sql',
        )
        return
      }
      console.error('[flow-session] async save failed:', error.message)
    })
}

export async function clearFlowSession(
  userId: string,
  contactId: string,
  automationId?: string,
): Promise<void> {
  let q = supabaseAdmin()
    .from('automation_flow_sessions')
    .delete()
    .eq('user_id', userId)
    .eq('contact_id', contactId)
  if (automationId) q = q.eq('automation_id', automationId)
  await q
  await clearFlowSessionInRedis(userId, contactId)
}
