import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchMetaTemplateByName } from '@/lib/whatsapp/fetch-meta-template'

export interface TemplateForSend {
  name: string
  language: string
  body_text: string
  status: 'Draft' | 'Pending' | 'Approved' | 'Rejected'
  variable_mapping?: Record<string, number | string> | null
}

function pickLocalTemplate(
  rows: TemplateForSend[],
  language?: string,
): TemplateForSend | null {
  if (rows.length === 0) return null
  if (language) {
    return rows.find((r) => r.language === language) ?? null
  }
  const approved = rows.find((r) => r.status === 'Approved')
  return approved ?? rows[0]
}

/**
 * Resolve template from local DB, then Meta WABA if missing locally.
 */
export async function resolveTemplateForSend(
  db: SupabaseClient,
  args: {
    userId: string
    templateName: string
    language?: string
    wabaId: string
    accessToken: string
  },
): Promise<TemplateForSend> {
  const { userId, templateName, language, wabaId, accessToken } = args

  // Base columns only — variable_mapping is optional (migration 010).
  const { data: localRows, error: localError } = await db
    .from('message_templates')
    .select('name, language, body_text, status')
    .eq('user_id', userId)
    .eq('name', templateName)

  if (localError) {
    throw new Error(`Failed to load templates: ${localError.message}`)
  }

  let template = pickLocalTemplate(
    (localRows ?? []) as TemplateForSend[],
    language,
  )

  if (!template) {
    const fromMeta = await fetchMetaTemplateByName({
      wabaId,
      accessToken,
      name: templateName,
      language,
    })

    if (!fromMeta) {
      throw new Error(
        `Template "${templateName}" not found in CRM or on Meta. ` +
          'Go to Settings → Templates → "Sync from Meta", or pass `language` in the request (e.g. en_US).',
      )
    }

    template = fromMeta
  }

  return template
}
