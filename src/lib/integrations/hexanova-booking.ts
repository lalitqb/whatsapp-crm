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

