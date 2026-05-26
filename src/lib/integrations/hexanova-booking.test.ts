import { describe, expect, it } from 'vitest'
import { normalizePhonePrimary } from './hexanova-booking'

describe('normalizePhonePrimary', () => {
  it('returns last 10 digits', () => {
    expect(normalizePhonePrimary('917903949014')).toBe('7903949014')
    expect(normalizePhonePrimary('7903949014')).toBe('7903949014')
  })
})
