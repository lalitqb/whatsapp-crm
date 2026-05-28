import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { createMessageTemplate } from '@/lib/whatsapp/meta-api'
import {
  buildCreateTemplateComponents,
  categoryToMeta,
  normalizeTemplateName,
  statusAfterMetaCreate,
  type CrmTemplateCategory,
} from '@/lib/whatsapp/template-meta'

/**
 * POST /api/whatsapp/templates
 *
 * Creates a message template on Meta (WABA) and stores the row locally.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      name,
      category,
      language,
      body_text,
      header_type,
      header_content,
      footer_text,
      cta_button,
    } = body as {
      name?: string
      category?: CrmTemplateCategory
      language?: string
      body_text?: string
      header_type?: string | null
      header_content?: string | null
      footer_text?: string | null
      cta_button?: {
        type?: 'url' | 'phone'
        text?: string
        value?: string
      } | null
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Template name is required' }, { status: 400 })
    }
    if (!body_text?.trim()) {
      return NextResponse.json({ error: 'Body text is required' }, { status: 400 })
    }
    if (
      !category ||
      !['Marketing', 'Utility', 'Authentication'].includes(category)
    ) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }

    const metaName = normalizeTemplateName(name)
    if (!metaName) {
      return NextResponse.json(
        {
          error:
            'Template name must contain letters or numbers (Meta uses lowercase with underscores, e.g. welcome_message)',
        },
        { status: 400 },
      )
    }

    const lang = language?.trim() || 'en_US'
    const normalizedCta =
      cta_button?.type &&
      cta_button.text?.trim() &&
      cta_button.value?.trim()
        ? {
            type: cta_button.type,
            text: cta_button.text.trim(),
            value: cta_button.value.trim(),
          }
        : null

    if (
      header_type &&
      header_type !== 'text' &&
      ['image', 'video', 'document'].includes(header_type)
    ) {
      return NextResponse.json(
        {
          error:
            'Media headers (image, video, document) must be created in Meta WhatsApp Manager. Use no header or a text header here.',
        },
        { status: 400 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 },
      )
    }

    if (!config.waba_id) {
      return NextResponse.json(
        {
          error:
            'WABA ID missing. Add your WhatsApp Business Account ID in Settings → WhatsApp Config.',
        },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)
    const components = buildCreateTemplateComponents({
      body_text,
      footer_text,
      header_type: header_type || null,
      header_content,
      cta_button:
        normalizedCta && (normalizedCta.type === 'url' || normalizedCta.type === 'phone')
          ? normalizedCta
          : null,
    })

    let metaTemplate
    try {
      metaTemplate = await createMessageTemplate({
        wabaId: config.waba_id,
        accessToken,
        name: metaName,
        language: lang,
        category: categoryToMeta(category),
        components,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Meta API request failed'
      console.error('[templates POST] Meta create failed:', message)
      return NextResponse.json({ error: message }, { status: 502 })
    }

    console.info(
      '[templates POST] Meta template created:',
      metaTemplate.id,
      metaTemplate.status ?? 'no-status',
    )

    const row = {
      user_id: user.id,
      name: metaName,
      category,
      language: lang,
      header_type:
        header_type && header_type !== 'none' && header_type === 'text'
          ? 'text'
          : null,
      header_content: header_content?.trim() || null,
      body_text: body_text.trim(),
      footer_text: footer_text?.trim() || null,
      status: statusAfterMetaCreate(metaTemplate),
      updated_at: new Date().toISOString(),
    }

    const { data: existing } = await supabase
      .from('message_templates')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', metaName)
      .eq('language', lang)
      .maybeSingle()

    let templateId: string

    if (existing?.id) {
      const { data: updated, error: updateError } = await supabase
        .from('message_templates')
        .update(row)
        .eq('id', existing.id)
        .select('id')
        .single()

      if (updateError || !updated) {
        console.error('[templates POST] update failed:', updateError)
        return NextResponse.json(
          {
            error: 'Template created on Meta but failed to update locally',
            meta: metaTemplate,
          },
          { status: 500 },
        )
      }
      templateId = updated.id
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('message_templates')
        .insert(row)
        .select('id')
        .single()

      if (insertError || !inserted) {
        console.error('[templates POST] insert failed:', insertError)
        return NextResponse.json(
          {
            error: 'Template created on Meta but failed to save locally',
            meta: metaTemplate,
          },
          { status: 500 },
        )
      }
      templateId = inserted.id
    }

    return NextResponse.json({
      success: true,
      id: templateId,
      name: metaName,
      language: lang,
      status: row.status,
      meta_id: metaTemplate.id,
      message:
        row.status === 'Approved'
          ? 'Template created and approved on Meta.'
          : 'Template submitted to Meta for review. Sync from Meta to refresh status.',
    })
  } catch (error) {
    console.error('[templates POST] error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to create template',
      },
      { status: 500 },
    )
  }
}
