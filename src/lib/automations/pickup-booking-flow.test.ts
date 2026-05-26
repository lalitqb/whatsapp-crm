import { describe, expect, it } from 'vitest'
import { isBookPickupIntent } from './pickup-booking-flow'

describe('isBookPickupIntent', () => {
  it('matches quick reply button', () => {
    expect(isBookPickupIntent('📦 Book Pickup')).toBe(true)
    expect(isBookPickupIntent('book_pickup')).toBe(true)
    expect(isBookPickupIntent('Book Pickup')).toBe(true)
  })

  it('does not match ad opener text', () => {
    expect(isBookPickupIntent('I want to schedule a pickup')).toBe(false)
  })
})
