import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  isMediaHeaderType,
  sanitizeStorageFileName,
  validateHeaderMediaFile,
} from '@/lib/whatsapp/template-header-media'

type RouteCtx = { params: Promise<{ id: string }> }

async function getOwnedTemplate(userId: string, templateId: string) {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('message_templates')
    .select(
      'id, user_id, name, header_type, header_media_url, header_media_storage_path, header_media_filename',
    )
    .eq('id', templateId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

async function removeStoredFile(path: string | null | undefined) {
  if (!path?.trim()) return
  await supabaseAdmin().storage.from('template-headers').remove([path])
}

export async function POST(request: Request, ctx: RouteCtx) {
  const { id: templateId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const template = await getOwnedTemplate(user.id, templateId)
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  if (!isMediaHeaderType(template.header_type)) {
    return NextResponse.json(
      {
        error:
          'This template has no image/video/document header on Meta. Sync from Meta first, or pick a template with a media header.',
      },
      { status: 400 },
    )
  }

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }

  const validationError = validateHeaderMediaFile(
    template.header_type!,
    file.type || 'application/octet-stream',
    file.size,
  )
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const safeName = sanitizeStorageFileName(file.name || 'header.bin')
  const storagePath = `${user.id}/${templateId}/${Date.now()}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const admin = supabaseAdmin()
  const { error: uploadError } = await admin.storage
    .from('template-headers')
    .upload(storagePath, buffer, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: true,
    })

  if (uploadError) {
    if (uploadError.message.includes('Bucket not found')) {
      return NextResponse.json(
        {
          error:
            'Storage bucket missing. Run supabase/migrations/013_template_header_media.sql in Supabase.',
        },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: publicUrlData } = admin.storage
    .from('template-headers')
    .getPublicUrl(storagePath)
  const publicUrl = publicUrlData.publicUrl

  await removeStoredFile(template.header_media_storage_path)

  const { data: updated, error: updateError } = await admin
    .from('message_templates')
    .update({
      header_media_url: publicUrl,
      header_media_storage_path: storagePath,
      header_media_filename: safeName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId)
    .eq('user_id', user.id)
    .select(
      'id, header_media_url, header_media_filename, header_type, header_media_storage_path',
    )
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({
    message: 'Header media saved. Notifications API will use this automatically.',
    template: updated,
  })
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const { id: templateId } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const template = await getOwnedTemplate(user.id, templateId)
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  await removeStoredFile(template.header_media_storage_path)

  const { error: updateError } = await supabaseAdmin()
    .from('message_templates')
    .update({
      header_media_url: null,
      header_media_storage_path: null,
      header_media_filename: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId)
    .eq('user_id', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
