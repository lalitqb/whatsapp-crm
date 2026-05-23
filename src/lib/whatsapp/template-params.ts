/**
 * Map named API variables (customer_name, order_id) to Meta's positional
 * template parameters ({{1}}, {{2}}, …).
 */

export function extractTemplateSlots(body: string): number[] {
  const ids = new Set<number>()
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) {
    ids.add(Number(m[1]))
  }
  return Array.from(ids).sort((a, b) => a - b)
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
      if (entry) return String(variables[entry[0]] ?? '')
    }

    if (variables[String(slot)] !== undefined) {
      return String(variables[String(slot)])
    }

    if (variableOrder?.[slot - 1]) {
      return String(variables[variableOrder[slot - 1]] ?? '')
    }

    return ''
  })
}
