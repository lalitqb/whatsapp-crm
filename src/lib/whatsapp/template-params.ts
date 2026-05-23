/**
 * Map named API variables (customer_name, order_id) to Meta template parameters.
 * Supports positional templates ({{1}}, {{2}}) and named templates ({{customer_name}}).
 */

export interface BodyTemplateParameter {
  type: 'text'
  text: string
  parameter_name?: string
}

export function extractTemplateSlots(body: string): number[] {
  const ids = new Set<number>()
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) {
    ids.add(Number(m[1]))
  }
  return Array.from(ids).sort((a, b) => a - b)
}

/** Named placeholders in body, e.g. {{customer_name}} (not {{1}}). */
export function extractNamedParamNames(body: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const m of body.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/gi)) {
    const name = m[1].toLowerCase()
    if (!seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

export function isNamedParameterTemplate(bodyText: string): boolean {
  const hasNamed = /\{\{[a-z][a-z0-9_]*\}\}/i.test(bodyText)
  const hasPositional = /\{\{\d+\}\}/.test(bodyText)
  return hasNamed && !hasPositional
}

/** Meta rejects newlines/tabs in template variables. */
export function sanitizeTemplateVariableValue(value: unknown): string {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return text || '—'
}

export function resolveNamedTemplateParams(
  bodyText: string,
  variables: Record<string, string>,
  options?: {
    /** From message_templates.variable_mapping, e.g. { customer_name: 1, order_id: 2 } */
    mapping?: Record<string, number | string> | null
    /** Explicit order when mapping is not stored on the template */
    variableOrder?: string[]
  },
): string[] {
  const slots = extractTemplateSlots(bodyText)
  if (slots.length === 0) return []

  const { mapping, variableOrder } = options ?? {}

  return slots.map((slot) => {
    if (mapping) {
      const entry = Object.entries(mapping).find(
        ([, pos]) => Number(pos) === slot,
      )
      if (entry) {
        return sanitizeTemplateVariableValue(variables[entry[0]])
      }
    }

    if (variables[String(slot)] !== undefined) {
      return sanitizeTemplateVariableValue(variables[String(slot)])
    }

    if (variableOrder?.[slot - 1]) {
      return sanitizeTemplateVariableValue(variables[variableOrder[slot - 1]])
    }

    return '—'
  })
}

/**
 * Build body parameters for Meta send API (positional or named template format).
 */
export function buildBodyTemplateParameters(
  bodyText: string,
  variables: Record<string, string>,
  options?: {
    mapping?: Record<string, number | string> | null
    variableOrder?: string[]
  },
): BodyTemplateParameter[] {
  if (isNamedParameterTemplate(bodyText)) {
    const names = extractNamedParamNames(bodyText)
    return names.map((name) => ({
      type: 'text',
      parameter_name: name,
      text: sanitizeTemplateVariableValue(variables[name]),
    }))
  }

  const positional = resolveNamedTemplateParams(bodyText, variables, options)
  return positional.map((text) => ({ type: 'text', text }))
}
