import { describe, expect, it } from 'vitest'
import {
  extractTemplateSlots,
  resolveNamedTemplateParams,
} from './template-params'

describe('extractTemplateSlots', () => {
  it('returns sorted unique slots', () => {
    expect(extractTemplateSlots('Hi {{2}}, order {{1}}')).toEqual([1, 2])
  })
})

describe('resolveNamedTemplateParams', () => {
  const body = 'Hi {{1}}, your order {{2}} is ready for pickup.'

  it('uses variableOrder when provided', () => {
    expect(
      resolveNamedTemplateParams(body, {
        customer_name: 'Lalit',
        order_id: 'LD1234',
      }, { variableOrder: ['customer_name', 'order_id'] }),
    ).toEqual(['Lalit', 'LD1234'])
  })

  it('uses DB mapping when provided', () => {
    expect(
      resolveNamedTemplateParams(
        body,
        { customer_name: 'Lalit', order_id: 'LD1234' },
        { mapping: { customer_name: 1, order_id: 2 } },
      ),
    ).toEqual(['Lalit', 'LD1234'])
  })

  it('uses numeric string keys', () => {
    expect(
      resolveNamedTemplateParams(body, { '1': 'Lalit', '2': 'LD1234' }),
    ).toEqual(['Lalit', 'LD1234'])
  })
})
