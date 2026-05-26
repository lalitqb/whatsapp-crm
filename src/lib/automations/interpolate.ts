import { normalizePhonePrimary } from '@/lib/integrations/hexanova-booking'
import type { AutomationContext } from './engine'

export interface InterpolateExtras {
  contact?: { name?: string | null; phone?: string | null; email?: string | null }
}

export function getNestedVar(
  vars: Record<string, unknown> | undefined,
  path: string,
): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((obj, key) => {
    if (obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)) {
      return (obj as Record<string, unknown>)[key]
    }
    return undefined
  }, vars)
}

export function interpolate(
  template: string,
  context: AutomationContext,
  extras?: InterpolateExtras,
): string {
  const vars = (context.vars ?? {}) as Record<string, unknown>
  const contact = extras?.contact

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const k = String(key)
    if (k === 'message.text') return String(context.message_text ?? '')
    if (k === 'contact.phone') return contact?.phone ?? ''
    if (k === 'contact.phone_primary') {
      return contact?.phone ? normalizePhonePrimary(contact.phone) : ''
    }
    if (k === 'contact.name') return contact?.name ?? ''
    if (k === 'contact.email') return contact?.email ?? ''
    if (k.startsWith('vars.')) {
      const v = getNestedVar(vars, k.slice(5))
      return v != null ? String(v) : ''
    }
    if (k.startsWith('env.')) {
      const envKey = k.slice(4)
      return process.env[envKey] ?? ''
    }
    // Shorthand env names used in templates
    if (k === 'HEXANOVA_BOOKING_API_URL') {
      return process.env.HEXANOVA_BOOKING_API_URL ?? ''
    }
    if (k === 'HEXANOVA_BOOKING_API_KEY') {
      return process.env.HEXANOVA_BOOKING_API_KEY ?? ''
    }
    const fromVars = getNestedVar(vars, k)
    if (fromVars != null) return String(fromVars)
    return ''
  })
}
