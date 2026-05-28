/**
 * Emerald Wash / Hexanova pickup booking API.
 *
 * Env (server-only):
 *   HEXANOVA_BOOKING_API_URL — e.g. https://api.hexanova.in/api
 *   HEXANOVA_BOOKING_API_KEY — X-Api-Key value
 */

export interface HexanovaBookingPayload {
  date: string
  locality: string
  name: string
  phonePrimary: string
  pickupAddress: string
  timeSlot: string
}

export interface HexanovaBookingResult {
  ok: boolean
  status: number
  data: unknown
  error?: string
}

function bookingConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.HEXANOVA_BOOKING_API_URL?.trim()
  const apiKey = process.env.HEXANOVA_BOOKING_API_KEY?.trim()
  if (!baseUrl || !apiKey) return null
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey }
}

/** Normalize Indian mobile to 10 digits for phonePrimary. */
export function normalizePhonePrimary(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** Parse customer date input to YYYY-MM-DD when possible. */
export function parseBookingDate(text: string): string | null {
  const t = text.trim()
  if (DATE_ISO_RE.test(t)) {
    const [y, m, d] = t.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) return t
    return null
  }
  const dmy = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) {
    const [, d, m, y] = dmy
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    const [yy, mm, dd] = iso.split('-').map(Number)
    const dt = new Date(yy, mm - 1, dd)
    if (dt.getFullYear() === yy && dt.getMonth() === mm - 1 && dt.getDate() === dd) return iso
  }
  return null
}

/**
 * Optional slot reshaping for long WhatsApp button labels only.
 * Hexanova accepts values like "9-11 AM" and "tomorrow" — do not rewrite those.
 */
export function normalizeBookingTimeSlot(text: string): string {
  const t = text.trim()
  if (!t) return t

  // Only reshape Meta-style labels: "11:00 AM - 1:00 PM" → keep as-is for API;
  // legacy compact "11-13" conversion broke slots like "9-11 AM".
  const metaButton = t.match(
    /^(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)$/i,
  )
  if (metaButton) {
    return `${metaButton[1]} - ${metaButton[2]}`
  }

  return t
}

export function extractLocalityFromAddress(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) return parts[parts.length - 2] ?? parts[0]
  return parts[0] ?? 'Locality'
}

function pickVar(vars: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = vars[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/**
 * Fill booking JSON from automation vars when body placeholders use a different
 * name than wait_for_reply save_reply_to (e.g. vars.address vs pickupAddress).
 */
export function enrichBookingPostBody(
  bodyText: string,
  vars?: Record<string, unknown>,
): string {
  if (!vars || Object.keys(vars).length === 0) return bodyText

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>
  } catch {
    return bodyText
  }

  const address = pickVar(vars, [
    'pickup_address',
    'pickupAddress',
    'address',
    'customer_address',
  ])
  const date = pickVar(vars, ['pickup_date', 'date'])
  const timeSlot = pickVar(vars, ['pickup_slot', 'pickupSlot', 'timeSlot', 'time_slot'])

  if (!(typeof parsed.pickupAddress === 'string' && parsed.pickupAddress.trim()) && address) {
    parsed.pickupAddress = address
  }
  if (!(typeof parsed.locality === 'string' && parsed.locality.trim()) && address) {
    parsed.locality = extractLocalityFromAddress(address)
  }
  if (!(typeof parsed.date === 'string' && parsed.date.trim()) && date) {
    parsed.date = date
  }
  if (!(typeof parsed.timeSlot === 'string' && parsed.timeSlot.trim()) && timeSlot) {
    parsed.timeSlot = timeSlot
  }

  return JSON.stringify(parsed)
}

/**
 * Normalize automation POST /bookings JSON before send.
 * Prefer contact.name for `name`, fix date/slot/phone, and derive locality from address.
 */
export function normalizeBookingPostBody(
  bodyText: string,
  contact?: { name?: string | null; phone?: string | null },
): string {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>
  } catch {
    return bodyText
  }

  const contactName = contact?.name?.trim()
  const bodyName = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  const name =
    contactName && contactName !== contact?.phone
      ? contactName
      : bodyName || contactName || 'Customer'

  let date = typeof parsed.date === 'string' ? parsed.date.trim() : ''
  // API accepts natural language (e.g. "tomorrow"); only rewrite when we parse DMY/ISO.
  const parsedDate = parseBookingDate(date)
  if (parsedDate) date = parsedDate

  // Pass through API-compatible slots (e.g. "9-11 AM"); light trim only.
  let timeSlot =
    typeof parsed.timeSlot === 'string' ? normalizeBookingTimeSlot(parsed.timeSlot) : ''

  let phonePrimary =
    typeof parsed.phonePrimary === 'string' ? parsed.phonePrimary.trim() : ''
  if (contact?.phone) {
    phonePrimary = normalizePhonePrimary(phonePrimary || contact.phone)
  } else if (phonePrimary) {
    phonePrimary = normalizePhonePrimary(phonePrimary)
  }

  let pickupAddress =
    typeof parsed.pickupAddress === 'string' ? parsed.pickupAddress.trim() : ''
  let locality = typeof parsed.locality === 'string' ? parsed.locality.trim() : ''
  if (!locality && pickupAddress) locality = extractLocalityFromAddress(pickupAddress)
  if (!pickupAddress && locality) pickupAddress = locality

  return JSON.stringify({
    ...parsed,
    name,
    date,
    timeSlot,
    phonePrimary,
    locality,
    pickupAddress,
  })
}

export interface BookingPayloadCheck {
  ok: boolean
  missing: string[]
  payload: HexanovaBookingPayload
}

/** Client-side checks before calling POST /bookings (avoids vague API "Validation failed"). */
export function checkBookingPayload(bodyText: string): BookingPayloadCheck {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>
  } catch {
    return {
      ok: false,
      missing: ['body (invalid JSON)'],
      payload: {
        name: '',
        locality: '',
        pickupAddress: '',
        date: '',
        timeSlot: '',
        phonePrimary: '',
      },
    }
  }

  const payload: HexanovaBookingPayload = {
    name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
    locality: typeof parsed.locality === 'string' ? parsed.locality.trim() : '',
    pickupAddress:
      typeof parsed.pickupAddress === 'string' ? parsed.pickupAddress.trim() : '',
    date: typeof parsed.date === 'string' ? parsed.date.trim() : '',
    timeSlot: typeof parsed.timeSlot === 'string' ? parsed.timeSlot.trim() : '',
    phonePrimary:
      typeof parsed.phonePrimary === 'string' ? parsed.phonePrimary.trim() : '',
  }

  const missing: string[] = []
  if (!payload.name) missing.push('name')
  if (!payload.pickupAddress) missing.push('pickupAddress')
  if (!payload.date) missing.push('date')
  if (!payload.timeSlot) missing.push('timeSlot')
  if (!payload.phonePrimary) missing.push('phonePrimary')

  return { ok: missing.length === 0, missing, payload }
}

/**
 * Create a pickup booking. Uses POST by default (GET+body is unreliable in fetch).
 * Set HEXANOVA_BOOKING_USE_GET=true to match legacy GET+JSON-body integrations.
 */
export async function createHexanovaBooking(
  payload: HexanovaBookingPayload,
): Promise<HexanovaBookingResult> {
  const cfg = bookingConfig()
  if (!cfg) {
    return {
      ok: false,
      status: 0,
      data: null,
      error:
        'HEXANOVA_BOOKING_API_URL and HEXANOVA_BOOKING_API_KEY must be set in environment variables',
    }
  }

  const url = `${cfg.baseUrl}/bookings`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Key': cfg.apiKey,
  }

  const useGet = process.env.HEXANOVA_BOOKING_USE_GET === 'true'
  const init: RequestInit = {
    method: useGet ? 'GET' : 'POST',
    headers,
    body: JSON.stringify(payload),
  }

  try {
    const res = await fetch(url, init)
    const text = await res.text()
    let data: unknown = text
    try {
      data = JSON.parse(text)
    } catch {
      // keep raw text
    }
    if (!res.ok) {
      const errMsg =
        typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message: unknown }).message)
          : text || `HTTP ${res.status}`
      return { ok: false, status: res.status, data, error: errMsg }
    }
    return { ok: true, status: res.status, data }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function isHexanovaBookingConfigured(): boolean {
  return bookingConfig() !== null
}

export interface HexanovaCustomerProfile {
  name?: string
  locality?: string
  pickupAddress?: string
  phonePrimary?: string
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
  }
}

/** GET /bookings/customer?phone=7903949014 */
export async function fetchHexanovaCustomerByPhone(
  phone: string,
): Promise<{ found: boolean; customer: HexanovaCustomerProfile | null; error?: string }> {
  const cfg = bookingConfig()
  if (!cfg) {
    return { found: false, customer: null, error: 'booking API not configured' }
  }

  const phonePrimary = normalizePhonePrimary(phone)
  const url = `${cfg.baseUrl}/bookings/customer?phone=${encodeURIComponent(phonePrimary)}`

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(cfg.apiKey),
    })
    const text = await res.text()
    let data: unknown = text
    try {
      data = JSON.parse(text)
    } catch {
      // raw
    }

    if (res.status === 404) {
      return { found: false, customer: null }
    }
    if (!res.ok) {
      const errMsg =
        typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message: unknown }).message)
          : text || `HTTP ${res.status}`
      return { found: false, customer: null, error: errMsg }
    }

    const customer = normalizeCustomerPayload(data)
    return { found: Boolean(customer), customer }
  } catch (err) {
    return {
      found: false,
      customer: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function normalizeCustomerPayload(data: unknown): HexanovaCustomerProfile | null {
  if (!data || typeof data !== 'object') return null

  const root = data as Record<string, unknown>
  const row =
    (root.customer as Record<string, unknown> | undefined) ??
    (root.data as Record<string, unknown> | undefined) ??
    (Array.isArray(root.data) ? (root.data[0] as Record<string, unknown>) : undefined) ??
    root

  if (!row || typeof row !== 'object') return null

  const name = pickString(row, ['name', 'customerName', 'customer_name'])
  const locality = pickString(row, ['locality', 'area', 'city'])
  const pickupAddress = pickString(row, [
    'pickupAddress',
    'pickup_address',
    'address',
    'pickupAddressLine',
  ])
  const phonePrimary = pickString(row, ['phonePrimary', 'phone', 'mobile'])

  if (!name && !pickupAddress && !locality) return null

  return {
    name: name ?? undefined,
    locality: locality ?? undefined,
    pickupAddress: pickupAddress ?? undefined,
    phonePrimary: phonePrimary ? normalizePhonePrimary(phonePrimary) : undefined,
  }
}

/**
 * Hexanova customer lookup: `{ success, data: { found, name, ... } }`.
 * Used by automation http_request steps after GET /bookings/customer.
 */
export function parseCustomerLookupResult(data: unknown): {
  found: boolean
  customer: HexanovaCustomerProfile | null
} {
  if (!data || typeof data !== 'object') {
    return { found: false, customer: null }
  }

  const root = data as Record<string, unknown>

  if (root.success === false) {
    return { found: false, customer: null }
  }

  const block = root.data
  if (block && typeof block === 'object' && !Array.isArray(block)) {
    const row = block as Record<string, unknown>
    if (row.found === false) {
      return { found: false, customer: null }
    }
    if (row.found === true) {
      const customer = normalizeCustomerPayload(data)
      return { found: Boolean(customer), customer }
    }
  }

  const customer = normalizeCustomerPayload(data)
  return { found: Boolean(customer), customer }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

