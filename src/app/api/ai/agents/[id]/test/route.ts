import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runAgentTestChat, type AiAgentRow } from '@/lib/ai/agent-runner'
import { isOpenAiConfigured } from '@/lib/ai/openai-client'

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isOpenAiConfigured()) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not set in server environment.' },
      { status: 503 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const message = String(body.message ?? '').trim()
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const { data: agent, error } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const result = await runAgentTestChat({
      agent: agent as AiAgentRow,
      message,
    })
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Test failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
