import { describe, expect, it } from 'vitest'
import {
  normalizePhonePrimary,
  normalizeCustomerPayload,
  enrichBookingPostBody,
  normalizeBookingPostBody,
  normalizeBookingTimeSlot,
  parseBookingDate,
  parseCustomerLookupResult,
  checkBookingPayload,
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

describe('parseBookingDate', () => {
  it('accepts ISO dates', () => {
    expect(parseBookingDate('2026-05-30')).toBe('2026-05-30')
    expect(parseBookingDate('2026-06-45')).toBeNull()
  })
})

describe('normalizeBookingTimeSlot', () => {
  it('keeps API slot formats like 9-11 AM', () => {
    expect(normalizeBookingTimeSlot('9-11 AM')).toBe('9-11 AM')
    expect(normalizeBookingTimeSlot('11-1')).toBe('11-1')
  })

  it('normalizes Meta button spacing only', () => {
    expect(normalizeBookingTimeSlot('11:00 AM - 1:00 PM')).toBe('11:00 AM - 1:00 PM')
  })
})

describe('enrichBookingPostBody', () => {
  it('fills pickupAddress from vars.address when template used pickupAddress placeholder', () => {
    const out = JSON.parse(
      enrichBookingPostBody(
        JSON.stringify({
          name: 'Lalit',
          locality: '',
          pickupAddress: '',
          date: 'tomorrow',
          timeSlot: '9-11 AM',
          phonePrimary: '7903949014',
        }),
        {
          address: 'H.no 1357, b/block, Nayaline somari',
          pickup_date: 'tomorrow',
          pickup_slot: '9-11 AM',
        },
      ),
    )
    expect(out.pickupAddress).toBe('H.no 1357, b/block, Nayaline somari')
    expect(out.locality).toBeTruthy()
  })
})

describe('normalizeBookingPostBody', () => {
  it('uses contact name, keeps tomorrow and 9-11 AM for API', () => {
    const out = JSON.parse(
      normalizeBookingPostBody(
        JSON.stringify({
          name: '',
          locality: '',
          pickupAddress: 'H.no 1, Sonari, Jamshedpur',
          date: 'tomorrow',
          timeSlot: '9-11 AM',
          phonePrimary: '917903949014',
        }),
        { name: 'Lalit Kumar Sahu', phone: '917903949014' },
      ),
    )
    expect(out.name).toBe('Lalit Kumar Sahu')
    expect(out.date).toBe('tomorrow')
    expect(out.timeSlot).toBe('9-11 AM')
    expect(out.phonePrimary).toBe('7903949014')
    expect(out.locality).toBeTruthy()
  })

  it('still converts DMY dates to ISO when parseable', () => {
    const out = JSON.parse(
      normalizeBookingPostBody(
        JSON.stringify({
          name: 'Test',
          locality: 'X',
          pickupAddress: 'Addr',
          date: '30/05/2026',
          timeSlot: '9-11 AM',
          phonePrimary: '7903949014',
        }),
        null,
      ),
    )
    expect(out.date).toBe('2026-05-30')
  })
})

describe('checkBookingPayload', () => {
  it('flags empty date or timeSlot before API call', () => {
    const check = checkBookingPayload(
      JSON.stringify({
        name: 'Lalit',
        locality: 'Sonari',
        pickupAddress: 'Addr',
        date: '',
        timeSlot: '',
        phonePrimary: '7903949014',
      }),
    )
    expect(check.ok).toBe(false)
    expect(check.missing).toContain('date')
    expect(check.missing).toContain('timeSlot')
  })
})
