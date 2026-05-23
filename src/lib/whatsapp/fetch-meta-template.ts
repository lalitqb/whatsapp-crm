import { categoryFromMeta, statusFromMeta } from '@/lib/whatsapp/template-meta'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
}

interface MetaTemplate {
  id: string
  name: string
  language: string
  status: string
  category: string
  components?: MetaTemplateComponent[]
}

export interface ResolvedTemplateRow {
  name: string
  language: string
  body_text: string
  status: 'Draft' | 'Pending' | 'Approved' | 'Rejected'
  variable_mapping?: Record<string, number | string> | null
}

function parseMetaTemplate(t: MetaTemplate): ResolvedTemplateRow {
  const body = (t.components ?? []).find((c) => c.type === 'BODY')
  return {
    name: t.name,
    language: t.language,
    body_text: body?.text ?? '',
    status: statusFromMeta(t.status),
  }
}

/**
 * Fetch a template by name from Meta's WABA catalog (not the local DB).
 */
export async function fetchMetaTemplateByName(args: {
  wabaId: string
  accessToken: string
  name: string
  language?: string
}): Promise<ResolvedTemplateRow | null> {
  const { wabaId, accessToken, name, language } = args
  const params = new URLSearchParams({
    limit: '100',
    fields: 'id,name,language,status,category,components',
    name,
  })

  const url = `${META_API_BASE}/${wabaId}/message_templates?${params}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    return null
  }

  const body = (await res.json()) as { data?: MetaTemplate[] }
  const matches = (body.data ?? []).filter((t) => t.name === name)
  if (matches.length === 0) return null

  if (language) {
    const exact = matches.find((t) => t.language === language)
    if (exact) return parseMetaTemplate(exact)
  }

  const approved = matches.find((t) => t.status.toUpperCase() === 'APPROVED')
  return parseMetaTemplate(approved ?? matches[0])
}
