import { describe, expect, it } from 'vitest'
import { canonicalContactPhone } from '@/lib/inbox/conversation-store'

describe('canonicalContactPhone', () => {
  it('normalizes Indian mobiles to 91 prefix', () => {
    expect(canonicalContactPhone('7485033880')).toBe('917485033880')
    expect(canonicalContactPhone('917485033880')).toBe('917485033880')
  })
})
