import { preparePhoneForMeta } from '@/lib/whatsapp/phone-utils'

export interface ParsedContactRow {
  phone: string
  name?: string
  email?: string
  company?: string
}

/** Split one CSV line into fields (handles quoted commas). */
export function splitCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  values.push(current.trim())
  return values.map((v) => v.replace(/^["']|["']$/g, '').trim())
}

const PHONE_HEADER_ALIASES = [
  'phone',
  'mobile',
  'phone number',
  'phonenumber',
  'phone_number',
  'contact',
  'whatsapp',
  'cell',
]

const NAME_HEADER_ALIASES = ['name', 'full name', 'fullname', 'contact name', 'customer name']
const EMAIL_HEADER_ALIASES = ['email', 'e-mail', 'email address']
const COMPANY_HEADER_ALIASES = ['company', 'organization', 'org', 'business']

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ')
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeader)
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias)
    if (idx >= 0) return idx
  }
  return -1
}

function rowHasPhoneColumn(headers: string[]): boolean {
  return findColumnIndex(headers, PHONE_HEADER_ALIASES) >= 0
}

/**
 * Parse contact CSV export text.
 * Skips leading blank rows (common in spreadsheet exports) and finds the real header row.
 */
export function parseContactsCsv(text: string): ParsedContactRow[] {
  const cleaned = text.replace(/^\uFEFF/, '').trim()
  if (!cleaned) return []

  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) return []

  let headerLineIndex = -1
  let headers: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const candidate = splitCsvLine(lines[i])
    if (!rowHasPhoneColumn(candidate)) continue
    headerLineIndex = i
    headers = candidate
    break
  }

  if (headerLineIndex < 0) return []

  const phoneIdx = findColumnIndex(headers, PHONE_HEADER_ALIASES)
  const nameIdx = findColumnIndex(headers, NAME_HEADER_ALIASES)
  const emailIdx = findColumnIndex(headers, EMAIL_HEADER_ALIASES)
  const companyIdx = findColumnIndex(headers, COMPANY_HEADER_ALIASES)

  const rows: ParsedContactRow[] = []

  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i])
    const rawPhone = values[phoneIdx]?.trim()
    if (!rawPhone) continue

    const phone = preparePhoneForMeta(rawPhone)
    if (!phone) continue

    rows.push({
      phone,
      name: nameIdx >= 0 ? values[nameIdx]?.trim() || undefined : undefined,
      email: emailIdx >= 0 ? values[emailIdx]?.trim() || undefined : undefined,
      company: companyIdx >= 0 ? values[companyIdx]?.trim() || undefined : undefined,
    })
  }

  return rows
}
