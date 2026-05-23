/**
 * Helpers for Meta WhatsApp message template create/sync.
 */

export type MetaTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'

export type CrmTemplateCategory = 'Marketing' | 'Utility' | 'Authentication'

export function categoryToMeta(category: CrmTemplateCategory): MetaTemplateCategory {
  switch (category) {
    case 'Utility':
      return 'UTILITY'
    case 'Authentication':
      return 'AUTHENTICATION'
    default:
      return 'MARKETING'
  }
}

export function categoryFromMeta(meta: string): CrmTemplateCategory {
  const upper = meta.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

export function statusFromMeta(
  meta: string,
): 'Draft' | 'Pending' | 'Approved' | 'Rejected' {
  switch (meta.toUpperCase()) {
    case 'APPROVED':
      return 'Approved'
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
      return 'Pending'
    case 'REJECTED':
    case 'DISABLED':
    case 'PAUSED':
      return 'Rejected'
    default:
      return 'Draft'
  }
}

/** Status to store after a successful Meta create API call. */
export function statusAfterMetaCreate(meta: { status?: string }): 'Pending' | 'Approved' | 'Rejected' {
  if (!meta.status) return 'Pending'
  const mapped = statusFromMeta(meta.status)
  return mapped === 'Draft' ? 'Pending' : mapped
}

/** Meta requires lowercase names with underscores only. */
/** Meta locale codes are case-sensitive (e.g. en_US, not en_us). */
export function normalizeMetaLanguageCode(code?: string | null): string {
  if (!code?.trim()) return 'en_US'
  const parts = code.trim().replace(/-/g, '_').split('_')
  const lang = parts[0]?.toLowerCase() ?? 'en'
  if (parts.length === 1) {
    if (lang === 'en') return 'en_US'
    if (lang === 'hi') return 'hi_IN'
    return lang
  }
  const region = parts.slice(1).join('_').toUpperCase()
  return `${lang}_${region}`
}

export function normalizeTemplateName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

export function buildCreateTemplateComponents(input: {
  body_text: string
  footer_text?: string | null
  header_type?: string | null
  header_content?: string | null
}): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = []

  if (input.header_type === 'text' && input.header_content?.trim()) {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: input.header_content.trim(),
    })
  }

  components.push({
    type: 'BODY',
    text: input.body_text.trim(),
  })

  if (input.footer_text?.trim()) {
    components.push({
      type: 'FOOTER',
      text: input.footer_text.trim(),
    })
  }

  return components
}
