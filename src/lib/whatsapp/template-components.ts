/**
 * Parse Meta template components for send-time parameters (body + URL buttons).
 */

export interface MetaTemplateButton {
  type: string
  text?: string
  url?: string
  phone_number?: string
}

export interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
  buttons?: MetaTemplateButton[]
  example?: Record<string, unknown>
}

/** URL buttons with a dynamic {{n}} suffix in the URL need a send-time parameter. */
export function getDynamicUrlButtonIndexes(
  components: MetaTemplateComponent[] | undefined,
): number[] {
  if (!components?.length) return []

  const buttonsBlock = components.find(
    (c) => c.type === 'BUTTONS' || c.type === 'buttons',
  )
  if (!buttonsBlock?.buttons?.length) return []

  const indexes: number[] = []
  buttonsBlock.buttons.forEach((btn, index) => {
    if (btn.type !== 'URL' || !btn.url) return
    if (/\{\{\d+\}\}/.test(btn.url)) {
      indexes.push(index)
    }
  })
  return indexes
}
