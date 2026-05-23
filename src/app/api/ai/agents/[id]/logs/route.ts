import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Math.min(
    parseInt(new URL(request.url).searchParams.get('limit') ?? '30', 10) || 30,
    100,
  )

  const { data, error } = await supabase
    .from('ai_agent_logs')
    .select(
      'id, customer_message, agent_reply, tool_calls, error, model, created_at',
    )
    .eq('agent_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ logs: [], migrationRequired: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ logs: data ?? [] })
}
