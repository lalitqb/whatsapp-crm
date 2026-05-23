export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  name?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCallResult {
  id: string
  name: string
  arguments: string
}

export interface ChatCompletionResult {
  content: string | null
  toolCalls: ToolCallResult[]
  promptTokens: number
  completionTokens: number
}

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

export async function chatCompletion(params: {
  model: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  temperature?: number
}): Promise<ChatCompletionResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Add it to .env.local to enable AI agents.',
    )
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.4,
  }
  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools
    body.tool_choice = 'auto'
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json()) as {
    error?: { message?: string }
    choices?: Array<{
      message?: {
        content?: string | null
        tool_calls?: Array<{
          id: string
          function: { name: string; arguments: string }
        }>
      }
    }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }

  if (!res.ok) {
    throw new Error(json.error?.message ?? `OpenAI API error ${res.status}`)
  }

  const message = json.choices?.[0]?.message
  const toolCalls =
    message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    })) ?? []

  return {
    content: message?.content ?? null,
    toolCalls,
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
  }
}
