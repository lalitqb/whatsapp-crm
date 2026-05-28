import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'
  | 'pickup_booking'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

/** Placeholder API config — users replace URLs and keys in each HTTP Request block. */
const PLACEHOLDER_API_HEADERS = { 'X-Api-Key': 'YOUR_API_KEY' } as const

const EXISTING_BOOKING_BODY = `{
  "name": "{{contact.name}}",
  "locality": "{{vars.customer_locality}}",
  "pickupAddress": "{{vars.customer_address}}",
  "date": "{{vars.pickup_date}}",
  "timeSlot": "{{vars.pickup_slot}}",
  "phonePrimary": "{{contact.phone_primary}}"
}`

const NEW_BOOKING_BODY = `{
  "name": "{{contact.name}}",
  "locality": "{{vars.pickup_address}}",
  "pickupAddress": "{{vars.pickup_address}}",
  "date": "{{vars.pickup_date}}",
  "timeSlot": "{{vars.pickup_slot}}",
  "phonePrimary": "{{contact.phone_primary}}"
}`

export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  welcome_message: {
    slug: 'welcome_message',
    name: 'Welcome Message',
    description: 'Auto-reply to first-time contacts with a greeting.',
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi! 👋 Thanks for reaching out. We'll get back to you shortly.",
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    name: 'Out of Office',
    description: 'Auto-reply during off-hours so nobody is left waiting.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Thanks for your message! Our team is offline right now (9am–6pm) and will reply first thing tomorrow.",
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    name: 'Lead Qualifier',
    description: 'Ask qualification questions to filter inbound leads.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['pricing', 'quote', 'buy'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Great — happy to help with pricing! Quick question: roughly how many seats are you looking for?",
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: 'Follow-up Reminder',
    description: 'Send a nudge if a contact has not replied within 24 hours.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Just circling back — did you have any other questions for us? Happy to help!",
        },
      },
    ],
  },
  pickup_booking: {
    slug: 'pickup_booking',
    name: 'Pickup booking (step-by-step)',
    description:
      'Look up customer by phone, branch existing vs new customer, collect replies one at a time, then call your booking API. Every message and URL is editable.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: [],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'http_request',
        step_config: {
          method: 'GET',
          url: 'https://api.hexanova.in/api/bookings/customer?phone={{contact.phone_primary}}',
          headers: { ...PLACEHOLDER_API_HEADERS },
          store_as: 'customer_lookup',
        },
      },
      {
        step_type: 'condition',
        step_config: { subject: 'variable_truthy', operand: 'customer_found' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: 'Hi {{contact.name}}! When would you like your pickup? Send the date (e.g. *tomorrow* or *2026-05-30*).',
        },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'wait_for_reply',
        step_config: { save_reply_to: 'pickup_date' },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'send_message',
        step_config: {
          text: 'Which *time slot* works for you? (e.g. 11-1)',
        },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'wait_for_reply',
        step_config: { save_reply_to: 'pickup_slot' },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'http_request',
        step_config: {
          method: 'POST',
          url: 'https://api.hexanova.in/api/bookings',
          headers: { ...PLACEHOLDER_API_HEADERS, 'Content-Type': 'application/json' },
          body_template: EXISTING_BOOKING_BODY,
          store_as: 'booking_result',
        },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'send_message',
        step_config: {
          text: '✅ Pickup booked for *{{vars.pickup_date}}* ({{vars.pickup_slot}}). We will confirm on WhatsApp.',
        },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi {{contact.name}}! Let's book your first pickup.\n\nPlease send your full *pickup address* (include area/city).",
        },
        parent_index: 1,
        branch: 'no',
      },
      {
        step_type: 'wait_for_reply',
        step_config: { save_reply_to: 'pickup_address' },
        parent_index: 1,
        branch: 'no',
      },
      {
        step_type: 'send_message',
        step_config: {
          text: 'When would you like pickup? Send the date (e.g. *tomorrow* or *2026-05-30*).',
        },
        parent_index: 1,
        branch: 'no',
      },
      {
        step_type: 'wait_for_reply',
        step_config: { save_reply_to: 'pickup_date' },
        parent_index: 1,
        branch: 'no',
      },
      {
        step_type: 'send_message',
        step_config: {
          text: 'Which *time slot* works for you?',
        },
        parent_index: 1,
        branch: 'no',
      },
      {
        step_type: 'wait_for_reply',
        step_config: { save_reply_to: 'pickup_slot' },
        parent_index: 1,
        branch: 'no',
      },
      {
        step_type: 'http_request',
        step_config: {
          method: 'POST',
          url: 'https://api.hexanova.in/api/bookings',
          headers: { ...PLACEHOLDER_API_HEADERS, 'Content-Type': 'application/json' },
          body_template: NEW_BOOKING_BODY,
          store_as: 'booking_result',
        },
        parent_index: 1,
        branch: 'no',
      },
      {
        step_type: 'send_message',
        step_config: {
          text: '✅ Pickup booked for *{{vars.pickup_date}}* ({{vars.pickup_slot}}). We will confirm on WhatsApp.',
        },
        parent_index: 1,
        branch: 'no',
      },
    ],
  },
}

export const TEMPLATE_SLUGS: TemplateSlug[] = [
  'pickup_booking',
  'welcome_message',
  'out_of_office',
  'lead_qualifier',
  'follow_up_reminder',
]

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}

/** Builder-local step shape (cid assigned here). */
export interface BuilderStepFromTemplate {
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStepFromTemplate[]; no: BuilderStepFromTemplate[] }
}

function newCid(): string {
  return (
    'c_' +
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

/** Expand flat template seeds into the nested tree the automation builder uses. */
export function expandTemplateSteps(seeds: TemplateStepSeed[]): BuilderStepFromTemplate[] {
  const nodes: BuilderStepFromTemplate[] = seeds.map((r) => ({
    cid: newCid(),
    step_type: r.step_type,
    step_config: (r.step_config ?? {}) as Record<string, unknown>,
    branches: r.step_type === 'condition' ? { yes: [], no: [] } : undefined,
  }))
  const roots: BuilderStepFromTemplate[] = []
  seeds.forEach((r, i) => {
    if (r.parent_index == null) {
      roots.push(nodes[i])
      return
    }
    const parent = nodes[r.parent_index]
    if (!parent.branches) parent.branches = { yes: [], no: [] }
    parent.branches[r.branch ?? 'yes'].push(nodes[i])
  })
  return roots
}

export function buildInitialFromTemplate(slug: TemplateSlug): {
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  steps: BuilderStepFromTemplate[]
} {
  const t = AUTOMATION_TEMPLATES[slug]
  return {
    name: t.name,
    description: t.description,
    trigger_type: t.trigger_type,
    trigger_config: t.trigger_config as Record<string, unknown>,
    steps: expandTemplateSteps(t.steps),
  }
}
