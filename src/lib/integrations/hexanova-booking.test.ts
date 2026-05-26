import { describe, expect, it } from 'vitest'
import {
  normalizePhonePrimary,
  normalizeCustomerPayload,
  parseCustomerLookupResult,
} from './hexanova-booking'

describe('normalizePhonePrimary', () => {
  it('returns last 10 digits', () => {
    expect(normalizePhonePrimary('917903949014')).toBe('7903949014')
    expect(normalizePhonePrimary('7903949014')).toBe('7903949014')
  })
})

describe('parseCustomerLookupResult', () => {
  const postmanPayload = {
    success: true,
    data: {
      found: true,
      customerId: '5198f569-0839-41a0-87bc-fb92ad1d226d',
      name: 'Lalit Sahu',
      phonePrimary: '7903949014',
      locality: 'Jamshedpur',
      pickupAddress: 'H.no 1357, B/Block, Nayaline, Sonari Jamshedpur',
    },
  }

  it('parses Hexanova success + data.found true', () => {
    const result = parseCustomerLookupResult(postmanPayload)
    expect(result.found).toBe(true)
    expect(result.customer?.name).toBe('Lalit Sahu')
    expect(result.customer?.locality).toBe('Jamshedpur')
  })

  it('returns found false when data.found is false', () => {
    const result = parseCustomerLookupResult({
      success: true,
      data: { found: false },
    })
    expect(result.found).toBe(false)
    expect(result.customer).toBeNull()
  })
})

describe('normalizeCustomerPayload', () => {
  it('reads customer from nested data block', () => {
    const customer = normalizeCustomerPayload({
      success: true,
      data: {
        found: true,
        name: 'Lalit Sahu',
        pickupAddress: 'Test Address',
        locality: 'Jamshedpur',
      },
    })
    expect(customer?.name).toBe('Lalit Sahu')
  })
})
