import { supabaseAdmin } from '@/lib/automations/admin-client'
import { phonesMatch, preparePhoneForMeta } from '@/lib/whatsapp/phone-utils'

/** Canonical E.164-style digits for DB storage (e.g. 917903949014). */
export function canonicalContactPhone(phone: string): string {
  return preparePhoneForMeta(phone)
}

/**
 * Pick one conversation when duplicates exist (most recently active).
 * Logs a warning so ops can merge legacy rows in Supabase.
 */
export async function getCanonicalConversation(
  userId: string,
  contactId: string,
): Promise<{ id: string; row: Record<string, unknown> } | null> {
  const { data: rows, error } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('[conversation-store] load failed:', error.message)
    return null
  }
  if (!rows?.length) return null

  const row = rows[0] as Record<string, unknown>
  if (rows.length > 1) {
    console.warn('[conversation-store] duplicate conversations for contact — using most recent', {
      userId,
      contactId,
      count: rows.length,
      usingId: row.id,
      duplicateIds: rows.slice(1).map((r) => (r as { id: string }).id),
    })
  }
  return { id: row.id as string, row }
}

export async function findOrCreateConversationForContact(
  userId: string,
  contactId: string,
): Promise<Record<string, unknown> | null> {
  const existing = await getCanonicalConversation(userId, contactId)
  if (existing) return existing.row

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      user_id: userId,
      contact_id: contactId,
    })
    .select()
    .single()

  if (createError) {
    // Unique race: another webhook may have inserted first.
    if (createError.code === '23505') {
      const retry = await getCanonicalConversation(userId, contactId)
      if (retry) return retry.row
    }
    console.error('[conversation-store] create failed:', createError.message)
    return null
  }

  return newConv as Record<string, unknown>
}

export interface ContactLookupResult {
  contact: Record<string, unknown>
  wasCreated: boolean
}

/**
 * Find contact by phone (handles 10-digit vs 91-prefix) or create with canonical phone.
 */
export async function findOrCreateContactByPhone(
  userId: string,
  rawPhone: string,
  name: string,
): Promise<ContactLookupResult | null> {
  const canonicalPhone = canonicalContactPhone(rawPhone)
  if (!canonicalPhone) {
    console.error('[conversation-store] invalid inbound phone:', rawPhone)
    return null
  }

  const { data: contacts, error: contactsError } = await supabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('user_id', userId)

  if (contactsError) {
    console.error('[conversation-store] contacts load failed:', contactsError.message)
    return null
  }

  const existing = (contacts ?? []).find((c) =>
    phonesMatch(String((c as { phone?: string }).phone ?? ''), canonicalPhone),
  ) as Record<string, unknown> | undefined

  if (existing?.id) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name && name !== existing.name) updates.name = name
    const stored = String(existing.phone ?? '')
    if (stored && !phonesMatch(stored, canonicalPhone)) {
      updates.phone = canonicalPhone
      console.warn('[conversation-store] normalized contact phone to canonical form', {
        contactId: existing.id,
        from: stored,
        to: canonicalPhone,
      })
    }
    if (Object.keys(updates).length > 1) {
      await supabaseAdmin()
        .from('contacts')
        .update(updates)
        .eq('id', existing.id as string)
    }
    return { contact: { ...existing, ...updates }, wasCreated: false }
  }

  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      user_id: userId,
      phone: canonicalPhone,
      name: name || canonicalPhone,
    })
    .select()
    .single()

  if (createError) {
    console.error('[conversation-store] contact create failed:', createError.message)
    return null
  }

  return { contact: newContact as Record<string, unknown>, wasCreated: true }
}

/** Resolve conversation id for automations (never throws on duplicate rows). */
export async function resolveConversationIdForContact(
  userId: string,
  contactId: string,
  preferredConversationId?: string | null,
): Promise<string> {
  if (preferredConversationId) return preferredConversationId
  const conv = await getCanonicalConversation(userId, contactId)
  if (!conv) throw new Error('no conversation for contact')
  return conv.id
}
