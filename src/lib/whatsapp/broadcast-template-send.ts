import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchMetaTemplateByName } from '@/lib/whatsapp/fetch-meta-template'
import { normalizeMetaLanguageCode } from '@/lib/whatsapp/template-meta'
import {
  broadcastParamsToVariables,
  buildTemplateSendPlanFromSources,
  type HeaderMediaInput,
} from '@/lib/whatsapp/template-send-plan'
import { headerTypeToMediaType } from '@/lib/whatsapp/template-header-media'

export interface BroadcastTemplateContext {
  templateName: string
  language: string
  bodyText: string
  storedHeaderMedia: HeaderMediaInput | null
  meta: {
    body_text: string
    components?: import('@/lib/whatsapp/template-components').MetaTemplateComponent[]
    parameter_format?: string | null
  } | null
}

export async function loadBroadcastTemplateContext(
  db: SupabaseClient,
  args: {
    userId: string
    templateName: string
    templateLanguage?: string
    wabaId: string | null
    accessToken: string
  },
): Promise<BroadcastTemplateContext> {
  const language = normalizeMetaLanguageCode(
    args.templateLanguage || 'en_US',
  )

  const { data: localRows } = await db
    .from('message_templates')
    .select(
      'name, language, body_text, header_type, header_media_url, header_media_filename, variable_mapping',
    )
    .eq('user_id', args.userId)
    .eq('name', args.templateName)

  const local =
    (localRows ?? []).find(
      (r) => r.language === language || r.language === args.templateLanguage,
    ) ??
    (localRows ?? []).find((r) => r.language === language) ??
    (localRows ?? [])[0] ??
    null

  let meta: BroadcastTemplateContext['meta'] = null
  if (args.wabaId) {
    const fromMeta = await fetchMetaTemplateByName({
      wabaId: args.wabaId,
      accessToken: args.accessToken,
      name: args.templateName,
      language,
    })
    if (fromMeta) {
      meta = {
        body_text: fromMeta.body_text,
        components: fromMeta.components,
        parameter_format: fromMeta.parameter_format,
      }
    }
  }

  const bodyText = meta?.body_text ?? local?.body_text ?? ''

  const storedHeaderMedia: HeaderMediaInput | null = local?.header_media_url
    ? {
        url: local.header_media_url,
        type: headerTypeToMediaType(local.header_type),
        filename: local.header_media_filename ?? undefined,
      }
    : null

  return {
    templateName: args.templateName,
    language,
    bodyText,
    storedHeaderMedia,
    meta,
  }
}

export function buildBroadcastRecipientSendPlan(
  ctx: BroadcastTemplateContext,
  params: string[],
) {
  const variables = broadcastParamsToVariables(
    params,
    ctx.bodyText,
    ctx.meta?.components,
    ctx.meta?.parameter_format,
  )

  return buildTemplateSendPlanFromSources(
    ctx.meta,
    { body_text: ctx.bodyText },
    variables,
    { headerMedia: ctx.storedHeaderMedia },
  )
}
