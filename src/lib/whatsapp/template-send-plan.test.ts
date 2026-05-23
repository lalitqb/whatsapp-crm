import { describe, expect, it } from 'vitest'
import { normalizeMetaLanguageCode } from './template-meta'
import {
  broadcastParamsToVariables,
  buildTemplateSendPlan,
  resolveHeaderMedia,
} from './template-send-plan'

describe('normalizeMetaLanguageCode', () => {
  it('normalizes en_us to en_US', () => {
    expect(normalizeMetaLanguageCode('en_us')).toBe('en_US')
    expect(normalizeMetaLanguageCode('en-US')).toBe('en_US')
  })
})

describe('buildTemplateSendPlan', () => {
  it('builds NAMED body params with parameter_name', () => {
    const plan = buildTemplateSendPlan(
      {
        body_text:
          'Hi {{customer_name}}, order {{order_id}} at {{pickup_address}}, {{pickup_time_slot}}.',
        parameter_format: 'NAMED',
        components: [
          {
            type: 'BODY',
            text: 'Hi {{customer_name}}, order {{order_id}}.',
            example: {
              body_text_named_params: [
                { param_name: 'customer_name' },
                { param_name: 'order_id' },
                { param_name: 'pickup_address' },
                { param_name: 'pickup_time_slot' },
              ],
            },
          },
        ],
      },
      {
        customer_name: 'Lalit',
        order_id: 'EW-0080',
        pickup_address: 'Jamshedpur',
        pickup_time_slot: '09:45',
        button_url_suffix: 'EW-0080',
      },
    )
    expect(plan.parameterFormat).toBe('NAMED')
    expect(plan.bodyParameters[0]).toMatchObject({
      parameter_name: 'customer_name',
      text: 'Lalit',
    })
  })

  it('resolves IMAGE header from headerMedia', () => {
    const components = [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Hello {{1}}' },
    ]
    const media = resolveHeaderMedia(components, {}, {
      url: 'https://cdn.example.com/banner.jpg',
      type: 'image',
    })
    expect(media).toEqual({
      type: 'image',
      url: 'https://cdn.example.com/banner.jpg',
    })

    const plan = buildTemplateSendPlan(
      {
        body_text: 'Hello {{1}}',
        parameter_format: 'POSITIONAL',
        components,
      },
      { '1': 'Lalit' },
      {
        headerMedia: { url: 'https://cdn.example.com/banner.jpg' },
      },
    )
    expect(plan.headerMedia?.type).toBe('image')
  })

  it('maps broadcast params array to named variables', () => {
    expect(
      broadcastParamsToVariables(
        ['Lalit', 'EW-1'],
        'Hi {{customer_name}}, order {{order_id}}',
        undefined,
        'NAMED',
      ),
    ).toEqual({ customer_name: 'Lalit', order_id: 'EW-1' })
  })

  it('adds URL button suffix for dynamic track link', () => {
    const plan = buildTemplateSendPlan(
      {
        body_text: 'Order {{1}} ready.',
        parameter_format: 'POSITIONAL',
        components: [
          { type: 'BODY', text: 'Order {{1}} ready.' },
          {
            type: 'BUTTONS',
            buttons: [
              {
                type: 'URL',
                text: 'Track',
                url: 'https://emeraldwash.in/o/{{1}}',
              },
            ],
          },
        ],
      },
      { '1': 'EW-0080', button_url_suffix: 'EW-0080' },
      { variableOrder: ['order_id'] },
    )
    expect(plan.buttonParameters).toHaveLength(1)
    expect(plan.buttonParameters[0].parameters[0].text).toBe('EW-0080')
  })
})
