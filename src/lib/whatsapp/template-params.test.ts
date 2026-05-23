import { describe, expect, it } from 'vitest'
import {
  buildBodyTemplateParameters,
  extractNamedParamNames,
  extractTemplateSlots,
  isNamedParameterTemplate,
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

describe('named parameter templates', () => {
  const namedBody =
    'Hi {{customer_name}}, order {{order_id}} at {{pickup_address}}, slot {{pickup_time_slot}}.'

  it('detects named format', () => {
    expect(isNamedParameterTemplate(namedBody)).toBe(true)
    expect(extractNamedParamNames(namedBody)).toEqual([
      'customer_name',
      'order_id',
      'pickup_address',
      'pickup_time_slot',
    ])
  })

  it('builds body parameters with parameter_name for Meta', () => {
    expect(
      buildBodyTemplateParameters(namedBody, {
        customer_name: 'Lalit',
        order_id: 'EW-0060',
        pickup_address: '12 Main St',
        pickup_time_slot: '10:00-12:00',
      }),
    ).toEqual([
      {
        type: 'text',
        parameter_name: 'customer_name',
        text: 'Lalit',
      },
      {
        type: 'text',
        parameter_name: 'order_id',
        text: 'EW-0060',
      },
      {
        type: 'text',
        parameter_name: 'pickup_address',
        text: '12 Main St',
      },
      {
        type: 'text',
        parameter_name: 'pickup_time_slot',
        text: '10:00-12:00',
      },
    ])
  })
})
