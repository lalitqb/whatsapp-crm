import { supabaseAdmin } from './admin-client'
import { engineSendText } from './meta-send'
import {
  createHexanovaBooking,
  fetchHexanovaCustomerByPhone,
  isHexanovaBookingConfigured,
  normalizePhonePrimary,
  type HexanovaBookingPayload,
  type HexanovaCustomerProfile,
} from '@/lib/integrations/hexanova-booking'

export const PICKUP_BOOKING_TAG_NAME = 'pickup_booking'
export const FLOW_TYPE = 'pickup_acquisition'

export type BookingSessionStep =
  | 'existing_ask_date'
  | 'existing_ask_slot'
  | 'new_ask_name'
  | 'new_ask_address'
  | 'new_ask_date'
  | 'new_ask_slot'

export interface BookingDraft {
  name?: string
  locality?: string
  pickupAddress?: string
  date?: string
  timeSlot?: string
  phonePrimary?: string
}

interface BookingSession {
  id: string
  user_id: string
  contact_id: string
  conversation_id: string | null
  step: BookingSessionStep
  customer_type: 'existing' | 'new'
  draft: BookingDraft
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Button / keyword titles that start the Book Pickup flow. */
export const BOOK_PICKUP_TRIGGERS = [
  'book pickup',
  'book_pickup',
  '📦 book pickup',
  'book a pickup',
]

export function isBookPickupIntent(text: string): boolean {
  const hay = text.toLowerCase().trim()
  return BOOK_PICKUP_TRIGGERS.some(
    (t) => hay === t.toLowerCase() || hay.includes(t.toLowerCase()),
  )
}

function parseDraft(raw: unknown): BookingDraft {
  if (!raw || typeof raw !== 'object') return {}
  return raw as BookingDraft
}

async function getSession(
  userId: string,
  contactId: string,
): Promise<BookingSession | null> {
  const { data, error } = await supabaseAdmin()
    .from('booking_conversation_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('flow_type', FLOW_TYPE)
    .maybeSingle()

  if (error?.code === '42P01') return null
  if (error || !data) return null

  return {
    id: data.id as string,
    user_id: data.user_id as string,
    contact_id: data.contact_id as string,
    conversation_id: (data.conversation_id as string | null) ?? null,
    step: data.step as BookingSessionStep,
    customer_type: data.customer_type as 'existing' | 'new',
    draft: parseDraft(data.draft),
  }
}

async function saveSession(session: {
  userId: string
  contactId: string
  conversationId: string
  step: BookingSessionStep
  customerType: 'existing' | 'new'
  draft: BookingDraft
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('booking_conversation_sessions')
    .upsert(
      {
        user_id: session.userId,
        contact_id: session.contactId,
        conversation_id: session.conversationId,
        flow_type: FLOW_TYPE,
        step: session.step,
        customer_type: session.customerType,
        draft: session.draft,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,contact_id,flow_type' },
    )
  if (error) console.error('[pickup-booking] save session failed:', error)
}

async function clearSession(userId: string, contactId: string): Promise<void> {
  await clearBookingConversationSession(userId, contactId)
}

/** Clear legacy pickup booking session (separate from automation_flow_sessions). */
export async function clearBookingConversationSession(
  userId: string,
  contactId: string,
): Promise<void> {
  await supabaseAdmin()
    .from('booking_conversation_sessions')
    .delete()
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('flow_type', FLOW_TYPE)
}

async function send(
  args: { userId: string; contactId: string; conversationId: string },
  text: string,
): Promise<void> {
  await engineSendText({ ...args, text })
}

function extractLocalityFromAddress(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) return parts[parts.length - 2] ?? parts[0]
  return parts[0] ?? 'Locality'
}

function parseDateInput(text: string): string | null {
  const t = text.trim()
  if (DATE_RE.test(t)) return t
  const dmy = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) {
    const [, d, m, y] = dmy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

function parseSlotInput(text: string): string | null {
  const t = text.trim()
  if (t.length < 2) return null
  return t
}

async function completeBooking(
  args: {
    userId: string
    contactId: string
    conversationId: string
    contactPhone: string
  },
  draft: BookingDraft,
): Promise<void> {
  if (!isHexanovaBookingConfigured()) {
    await send(
      args,
      'Our booking system is being configured. A team member will contact you shortly. 🙏',
    )
    await clearSession(args.userId, args.contactId)
    return
  }

  const payload: HexanovaBookingPayload = {
    name: draft.name ?? 'Customer',
    locality: draft.locality ?? extractLocalityFromAddress(draft.pickupAddress ?? ''),
    pickupAddress: draft.pickupAddress ?? '',
    date: draft.date!,
    timeSlot: draft.timeSlot!,
    phonePrimary:
      draft.phonePrimary?.trim() || normalizePhonePrimary(args.contactPhone),
  }

  const result = await createHexanovaBooking(payload)
  await clearSession(args.userId, args.contactId)

  if (!result.ok) {
    console.error('[pickup-booking] create failed:', result.error, result.data)
    await send(
      args,
      `Sorry, we couldn't confirm your booking (${result.error ?? 'error'}). Please try again or type *support*.`,
    )
    return
  }

  const ref =
    typeof result.data === 'object' && result.data !== null && 'id' in result.data
      ? String((result.data as { id: unknown }).id)
      : null

  await send(
    args,
    ref
      ? `✅ *Thank you!* Your pickup is booked.\n\n📋 Ref: ${ref}\n📅 ${payload.date} · ${payload.timeSlot}\n📍 ${payload.pickupAddress}\n\nWe'll WhatsApp you when the rider is on the way. 💚`
      : `✅ *Thank you!* Your pickup is booked for *${payload.date}* (${payload.timeSlot}).\n\nWe'll confirm shortly on WhatsApp. 💚`,
  )
}

/** Start guided flow after "Book Pickup" (looks up customer by phone). */
export async function startBookPickupConversation(args: {
  userId: string
  contactId: string
  conversationId: string
  contactPhone: string
  contactName: string | null
}): Promise<void> {
  const phone = normalizePhonePrimary(args.contactPhone)
  const lookup = await fetchHexanovaCustomerByPhone(args.contactPhone)

  if (lookup.customer) {
    const draft: BookingDraft = {
      name: lookup.customer.name ?? args.contactName ?? undefined,
      locality: lookup.customer.locality,
      pickupAddress: lookup.customer.pickupAddress,
      phonePrimary: lookup.customer.phonePrimary ?? phone,
    }
    await saveSession({
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      step: 'existing_ask_date',
      customerType: 'existing',
      draft,
    })
    const name = draft.name ? ` ${draft.name.split(' ')[0]}` : ''
    await send(
      args,
      `Hi${name}! 👋 I found your Emerald Wash profile.\n\nWhen would you like your pickup? Please send the *date* (YYYY-MM-DD), e.g. 2026-05-27.`,
    )
    return
  }

  await saveSession({
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    step: 'new_ask_name',
    customerType: 'new',
    draft: { phonePrimary: phone },
  })

  await send(
    args,
    "Welcome to Emerald Wash! 💚 Let's book your first pickup.\n\nWhat's your *full name*?",
  )
}

/** Process the next message in an active booking conversation. */
export async function handleBookingConversationMessage(args: {
  userId: string
  contactId: string
  conversationId: string
  messageText: string
  contactName: string | null
  contactPhone: string
}): Promise<boolean> {
  const session = await getSession(args.userId, args.contactId)
  if (!session) return false

  const text = args.messageText.trim()
  if (!text) return true

  const ctx = {
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
  }

  const draft = { ...session.draft }

  if (session.customer_type === 'existing') {
    if (session.step === 'existing_ask_date') {
      const date = parseDateInput(text)
      if (!date) {
        await send(ctx, 'Please send a valid date as *YYYY-MM-DD* (e.g. 2026-05-27).')
        return true
      }
      draft.date = date
      await saveSession({
        userId: args.userId,
        contactId: args.contactId,
        conversationId: args.conversationId,
        step: 'existing_ask_slot',
        customerType: 'existing',
        draft,
      })
      await send(
        ctx,
        `Date: *${date}* ✅\n\nWhich *time slot* works for you? (e.g. *11-1* or *10:00-12:00*)`,
      )
      return true
    }

    if (session.step === 'existing_ask_slot') {
      const slot = parseSlotInput(text)
      if (!slot) {
        await send(ctx, 'Please send a time slot (e.g. *11-1*).')
        return true
      }
      draft.timeSlot = slot
      await completeBooking({ ...ctx, contactPhone: args.contactPhone }, draft)
      return true
    }
  }

  if (session.step === 'new_ask_name') {
    if (text.length < 2) {
      await send(ctx, 'Please send your full name.')
      return true
    }
    draft.name = text
    await saveSession({
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      step: 'new_ask_address',
      customerType: 'new',
      draft,
    })
    await send(
      ctx,
      `Thanks, *${draft.name}*! 📍\n\nWhat's your full *pickup address*? (house no, street, area)`,
    )
    return true
  }

  if (session.step === 'new_ask_address') {
    if (text.length < 8) {
      await send(ctx, 'Please send a complete pickup address.')
      return true
    }
    draft.pickupAddress = text
    draft.locality = extractLocalityFromAddress(text)
    await saveSession({
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      step: 'new_ask_date',
      customerType: 'new',
      draft,
    })
    await send(
      ctx,
      'Got it! 📅\n\n*When* should we pick up? Send the date as *YYYY-MM-DD* (e.g. 2026-05-27).',
    )
    return true
  }

  if (session.step === 'new_ask_date') {
    const date = parseDateInput(text)
    if (!date) {
      await send(ctx, 'Please send a valid date as *YYYY-MM-DD*.')
      return true
    }
    draft.date = date
    await saveSession({
      userId: args.userId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      step: 'new_ask_slot',
      customerType: 'new',
      draft,
    })
    await send(
      ctx,
      `Date: *${date}* ✅\n\nWhich *time slot*? (e.g. *11-1*)`,
    )
    return true
  }

  if (session.step === 'new_ask_slot') {
    const slot = parseSlotInput(text)
    if (!slot) {
      await send(ctx, 'Please send a time slot (e.g. *11-1*).')
      return true
    }
    draft.timeSlot = slot
    await completeBooking({ ...ctx, contactPhone: args.contactPhone }, draft)
    return true
  }

  return true
}

/** Legacy export — engine step + webhook. */
export async function startPickupBookingFlow(args: {
  userId: string
  contactId: string
  conversationId: string
  contactPhone?: string
  contactName?: string | null
}): Promise<void> {
  await startBookPickupConversation({
    userId: args.userId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    contactPhone: args.contactPhone ?? '',
    contactName: args.contactName ?? null,
  })
}

/** Legacy export — webhook handler name. */
export const handlePickupBookingReply = handleBookingConversationMessage

export function customerProfileFromLookup(
  customer: HexanovaCustomerProfile | null,
): BookingDraft {
  if (!customer) return {}
  return {
    name: customer.name,
    locality: customer.locality,
    pickupAddress: customer.pickupAddress,
    phonePrimary: customer.phonePrimary,
  }
}
