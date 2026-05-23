import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildEmeraldWashAgentPayload } from '@/lib/ai/emeraldwash-preset'
import { isOpenAiConfigured } from '@/lib/ai/openai-client'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ai_agents')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({
        agents: [],
        migrationRequired: true,
        openAiConfigured: isOpenAiConfigured(),
      })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    agents: data ?? [],
    openAiConfigured: isOpenAiConfigured(),
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const preset = body.preset === 'emeraldwash'

  const payload = preset
    ? buildEmeraldWashAgentPayload(user.id)
    : {
        user_id: user.id,
        name: body.name ?? 'WhatsApp AI Agent',
        description: body.description ?? null,
        enabled: false,
        model: body.model ?? 'gpt-4o-mini',
        system_prompt:
          body.system_prompt ??
          'You are a helpful WhatsApp assistant for the business.',
        knowledge_base: body.knowledge_base ?? null,
        languages: body.languages ?? ['en', 'hi'],
        tools_config: body.tools_config ?? [],
        handoff_phrases: body.handoff_phrases ?? ['human', 'agent'],
        business_name: body.business_name ?? null,
        business_website: body.business_website ?? null,
        booking_api_url: body.booking_api_url ?? null,
        booking_api_key: body.booking_api_key ?? null,
        pause_when_assigned: body.pause_when_assigned ?? true,
        max_history_messages: body.max_history_messages ?? 20,
        reply_to_non_text: body.reply_to_non_text ?? false,
      }

  const { data, error } = await supabase
    .from('ai_agents')
    .insert(payload)
    .select()
    .single()

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json(
        {
          error:
            'Run supabase/migrations/012_ai_agents.sql in Supabase SQL Editor first.',
        },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ agent: data }, { status: 201 })
}
