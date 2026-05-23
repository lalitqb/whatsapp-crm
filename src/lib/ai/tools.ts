import type { ToolDefinition } from '@/lib/ai/openai-client'

export interface AiAgentToolRow {
  id: string
  enabled?: boolean
  label?: string
  description?: string
}

export interface AgentToolContext {
  bookingApiUrl?: string | null
  bookingApiKey?: string | null
  businessName?: string
}

export function buildOpenAiTools(
  toolsConfig: AiAgentToolRow[],
): ToolDefinition[] {
  const enabled = new Set(
    toolsConfig.filter((t) => t.enabled !== false).map((t) => t.id),
  )
  const defs: ToolDefinition[] = []

  if (enabled.has('check_pickup_slots')) {
    defs.push({
      type: 'function',
      function: {
        name: 'check_pickup_slots',
        description:
          'Get available pickup date and time windows for a customer pincode.',
        parameters: {
          type: 'object',
          properties: {
            pincode: { type: 'string', description: '6-digit Indian pincode' },
            date: {
              type: 'string',
              description: 'Preferred date YYYY-MM-DD (optional)',
            },
          },
          required: ['pincode'],
        },
      },
    })
  }

  if (enabled.has('create_booking')) {
    defs.push({
      type: 'function',
      function: {
        name: 'create_booking',
        description:
          'Create a doorstep pickup booking after the customer confirmed all details.',
        parameters: {
          type: 'object',
          properties: {
            customer_name: { type: 'string' },
            phone: { type: 'string', description: 'E.164 or 10-digit mobile' },
            address: { type: 'string' },
            pincode: { type: 'string' },
            service_type: {
              type: 'string',
              enum: ['wash_fold', 'dry_clean', 'express', 'other'],
            },
            pickup_date: { type: 'string', description: 'YYYY-MM-DD' },
            pickup_slot: {
              type: 'string',
              description: 'e.g. 10:00-12:00',
            },
            notes: { type: 'string' },
          },
          required: [
            'customer_name',
            'phone',
            'address',
            'pincode',
            'service_type',
            'pickup_date',
            'pickup_slot',
          ],
        },
      },
    })
  }

  if (enabled.has('get_order_status')) {
    defs.push({
      type: 'function',
      function: {
        name: 'get_order_status',
        description: 'Look up laundry order status by order ID or phone number.',
        parameters: {
          type: 'object',
          properties: {
            order_id: { type: 'string' },
            phone: { type: 'string' },
          },
        },
      },
    })
  }

  return defs
}

async function callBookingApi(
  ctx: AgentToolContext,
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<unknown> {
  const base = ctx.bookingApiUrl?.trim()
  if (!base) {
    return null
  }
  const url = `${base.replace(/\/$/, '')}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (ctx.bookingApiKey) {
    headers.Authorization = `Bearer ${ctx.bookingApiKey}`
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text, status: res.status }
  }
}

function mockSlots(pincode: string, date?: string) {
  const d = date ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  return {
    pincode,
    date: d,
    slots: ['10:00-12:00', '12:00-14:00', '16:00-18:00', '18:00-20:00'],
    note: 'Demo slots — connect booking_api_url for live availability.',
  }
}

function mockBooking(args: Record<string, unknown>) {
  const ref = `EW${Date.now().toString(36).toUpperCase().slice(-6)}`
  return {
    success: true,
    booking_reference: ref,
    message: `Pickup booked for ${args.pickup_date} (${args.pickup_slot}). Reference: ${ref}`,
    demo: true,
  }
}

function mockOrderStatus(args: Record<string, unknown>) {
  return {
    status: 'in_progress',
    stage: 'Processing at facility',
    estimated_delivery: 'Tomorrow by 6 PM',
    order_id: args.order_id ?? 'N/A',
    demo: true,
  }
}

export async function executeAgentTool(
  name: string,
  argsJson: string,
  ctx: AgentToolContext,
): Promise<string> {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>
  } catch {
    return JSON.stringify({ error: 'Invalid tool arguments JSON' })
  }

  try {
    if (name === 'check_pickup_slots') {
      const pincode = String(args.pincode ?? '')
      const date = args.date ? String(args.date) : undefined
      const live = await callBookingApi(
        ctx,
        `/slots?pincode=${encodeURIComponent(pincode)}${date ? `&date=${date}` : ''}`,
        'GET',
      )
      return JSON.stringify(live ?? mockSlots(pincode, date))
    }

    if (name === 'create_booking') {
      const live = await callBookingApi(ctx, '/bookings', 'POST', args)
      return JSON.stringify(live ?? mockBooking(args))
    }

    if (name === 'get_order_status') {
      const q = new URLSearchParams()
      if (args.order_id) q.set('order_id', String(args.order_id))
      if (args.phone) q.set('phone', String(args.phone))
      const live = await callBookingApi(
        ctx,
        `/orders/status?${q.toString()}`,
        'GET',
      )
      return JSON.stringify(live ?? mockOrderStatus(args))
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` })
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : 'Tool execution failed',
    })
  }
}
