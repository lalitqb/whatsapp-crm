import { createClient } from '@supabase/supabase-js'
import {
  chatCompletion,
  isOpenAiConfigured,
  type ChatMessage,
} from '@/lib/ai/openai-client'
import {
  buildOpenAiTools,
  executeAgentTool,
  type AiAgentToolRow,
} from '@/lib/ai/tools'
import { engineSendText } from '@/lib/automations/meta-send'

export interface AiAgentRow {
  id: string
  user_id: string
  name: string
  enabled: boolean
  model: string
  system_prompt: string
  knowledge_base: string | null
  languages: string[]
  tools_config: AiAgentToolRow[]
  handoff_phrases: string[]
  pause_when_assigned: boolean
  max_history_messages: number
  reply_to_non_text: boolean
  business_name: string | null
  business_website: string | null
  booking_api_url: string | null
  booking_api_key: string | null
}

export interface RunInboundAiArgs {
  userId: string
  conversationId: string
  contactId: string
  inboundText: string
  inboundMessageId: string
  contentType: string
}

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function wantsHandoff(text: string, phrases: string[]): boolean {
  const lower = text.toLowerCase()
  return phrases.some((p) => p.trim() && lower.includes(p.trim().toLowerCase()))
}

function buildSystemPrompt(agent: AiAgentRow): string {
  const langs = (agent.languages ?? ['en', 'hi']).join(', ')
  const parts = [
    agent.system_prompt,
    '',
    `Supported languages: ${langs}. Match the customer's language.`,
    agent.business_name
      ? `Business: ${agent.business_name}${agent.business_website ? ` (${agent.business_website})` : ''}`
      : '',
  ]
  if (agent.knowledge_base?.trim()) {
    parts.push('', '--- Knowledge base (use as source of truth) ---', agent.knowledge_base.trim())
  }
  return parts.filter(Boolean).join('\n')
}

async function loadHistory(
  conversationId: string,
  limit: number,
): Promise<ChatMessage[]> {
  const { data } = await supabaseAdmin()
    .from('messages')
    .select('sender_type, content_text, content_type, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  const rows = (data ?? []).reverse()
  const out: ChatMessage[] = []
  for (const row of rows) {
    const text = row.content_text?.trim()
    if (!text) continue
    if (row.sender_type === 'customer') {
      out.push({ role: 'user', content: text })
    } else if (row.sender_type === 'bot') {
      out.push({ role: 'assistant', content: text })
    } else if (row.sender_type === 'agent') {
      out.push({
        role: 'assistant',
        content: `[Human agent]: ${text}`,
      })
    }
  }
  return out
}

async function logAgentRun(params: {
  agentId: string
  userId: string
  conversationId: string
  contactId: string
  inboundMessageId: string
  customerMessage: string
  agentReply: string | null
  model: string
  toolCalls: unknown[]
  promptTokens: number
  completionTokens: number
  error: string | null
}) {
  await supabaseAdmin().from('ai_agent_logs').insert({
    agent_id: params.agentId,
    user_id: params.userId,
    conversation_id: params.conversationId,
    contact_id: params.contactId,
    inbound_message_id: params.inboundMessageId,
    customer_message: params.customerMessage,
    agent_reply: params.agentReply,
    model: params.model,
    tool_calls: params.toolCalls,
    prompt_tokens: params.promptTokens,
    completion_tokens: params.completionTokens,
    error: params.error,
  })
}

async function alreadyProcessed(inboundMessageId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('ai_agent_logs')
    .select('id')
    .eq('inbound_message_id', inboundMessageId)
    .maybeSingle()
  return Boolean(data)
}

export async function getEnabledAgent(userId: string): Promise<AiAgentRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('ai_agents')
    .select('*')
    .eq('user_id', userId)
    .eq('enabled', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error?.code === '42P01') return null
  if (error || !data) return null
  return data as AiAgentRow
}

/** Run AI for a test message (no WhatsApp send). */
export async function runAgentTestChat(params: {
  agent: AiAgentRow
  message: string
  history?: ChatMessage[]
}): Promise<{ reply: string; toolCalls: unknown[] }> {
  if (!isOpenAiConfigured()) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const tools = buildOpenAiTools(params.agent.tools_config ?? [])
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(params.agent) },
    ...(params.history ?? []),
    { role: 'user', content: params.message },
  ]

  const toolCtx = {
    bookingApiUrl: params.agent.booking_api_url,
    bookingApiKey: params.agent.booking_api_key,
    businessName: params.agent.business_name ?? undefined,
  }

  let totalPrompt = 0
  let totalCompletion = 0
  const toolLog: unknown[] = []
  const maxRounds = 5

  for (let round = 0; round < maxRounds; round++) {
    const result = await chatCompletion({
      model: params.agent.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    })
    totalPrompt += result.promptTokens
    totalCompletion += result.completionTokens

    if (result.toolCalls.length === 0) {
      return {
        reply: result.content?.trim() || 'Sorry, I could not generate a reply.',
        toolCalls: toolLog,
      }
    }

    messages.push({
      role: 'assistant',
      content: result.content,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    })

    for (const tc of result.toolCalls) {
      const output = await executeAgentTool(tc.name, tc.arguments, toolCtx)
      toolLog.push({ name: tc.name, arguments: tc.arguments, output })
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.name,
        content: output,
      })
    }
  }

  void totalPrompt
  void totalCompletion
  return {
    reply: 'I need a moment — please ask again or type "human" for our team.',
    toolCalls: toolLog,
  }
}

/** Process inbound WhatsApp message and reply via Meta if appropriate. */
export async function runInboundAiAgent(
  args: RunInboundAiArgs,
): Promise<void> {
  if (!isOpenAiConfigured()) return

  const agent = await getEnabledAgent(args.userId)
  if (!agent) return

  if (args.contentType !== 'text' && !agent.reply_to_non_text) return

  const text = args.inboundText.trim()
  if (!text) return

  if (await alreadyProcessed(args.inboundMessageId)) return

  if (wantsHandoff(text, agent.handoff_phrases ?? [])) {
    await logAgentRun({
      agentId: agent.id,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      inboundMessageId: args.inboundMessageId,
      customerMessage: text,
      agentReply: null,
      model: agent.model,
      toolCalls: [],
      promptTokens: 0,
      completionTokens: 0,
      error: 'handoff_requested',
    })
    await engineSendText({
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: 'Main aapko hamari team se jod raha hoon. / Connecting you with our team — someone will reply shortly. 🙏',
    })
    return
  }

  if (agent.pause_when_assigned) {
    const { data: conv } = await supabaseAdmin()
      .from('conversations')
      .select('assigned_agent_id')
      .eq('id', args.conversationId)
      .maybeSingle()
    if (conv?.assigned_agent_id) return
  }

  const history = await loadHistory(
    args.conversationId,
    agent.max_history_messages ?? 20,
  )

  try {
    const { reply, toolCalls } = await runAgentTestChat({
      agent,
      message: text,
      history: history.slice(0, -1),
    })

    await engineSendText({
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: reply,
    })

    await logAgentRun({
      agentId: agent.id,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      inboundMessageId: args.inboundMessageId,
      customerMessage: text,
      agentReply: reply,
      model: agent.model,
      toolCalls,
      promptTokens: 0,
      completionTokens: 0,
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI agent failed'
    console.error('[ai-agent]', message)
    await logAgentRun({
      agentId: agent.id,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      inboundMessageId: args.inboundMessageId,
      customerMessage: text,
      agentReply: null,
      model: agent.model,
      toolCalls: [],
      promptTokens: 0,
      completionTokens: 0,
      error: message,
    })
  }
}
