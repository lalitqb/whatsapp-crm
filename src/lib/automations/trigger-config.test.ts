import { describe, expect, it } from 'vitest'
import {
  messageMatchesKeywordTrigger,
  normalizeKeywordMatchConfig,
  normalizeKeywordMatchConfigRecord,
  parseKeywordsInput,
} from './trigger-config'

describe('parseKeywordsInput', () => {
  it('splits on commas and trims', () => {
    expect(parseKeywordsInput('pricing, quote , buy')).toEqual([
      'pricing',
      'quote',
      'buy',
    ])
  })
})

describe('normalizeKeywordMatchConfig', () => {
  it('defaults match_type to contains', () => {
    expect(normalizeKeywordMatchConfig({ keywords: ['hi'] })).toEqual({
      keywords: ['hi'],
      match_type: 'contains',
      case_sensitive: false,
    })
  })

  it('preserves exact match_type', () => {
    expect(
      normalizeKeywordMatchConfig({ keywords: ['hi'], match_type: 'exact' }),
    ).toEqual({
      keywords: ['hi'],
      match_type: 'exact',
      case_sensitive: false,
    })
  })
})

describe('normalizeKeywordMatchConfigRecord', () => {
  it('returns a plain record for builder state', () => {
    const record = normalizeKeywordMatchConfigRecord({
      keywords: 'schedule, pickup',
      match_type: 'contains',
    })
    expect(record).toEqual({
      keywords: ['schedule', 'pickup'],
      match_type: 'contains',
      case_sensitive: false,
    })
    const rec: Record<string, unknown> = record
    expect(rec.keywords).toEqual(['schedule', 'pickup'])
  })
})

describe('messageMatchesKeywordTrigger', () => {
  const message = 'I want to schedule a pickup'

  it('matches contains keywords like pickup or schedule', () => {
    expect(
      messageMatchesKeywordTrigger(message, {
        keywords: ['pickup'],
        match_type: 'contains',
      }),
    ).toBe(true)
    expect(
      messageMatchesKeywordTrigger(message, {
        keywords: ['schedule'],
        match_type: 'contains',
      }),
    ).toBe(true)
    expect(
      messageMatchesKeywordTrigger(message, {
        keywords: ['schedule a pickup'],
        match_type: 'contains',
      }),
    ).toBe(true)
  })

  it('does not match exact unless the full message equals the keyword', () => {
    expect(
      messageMatchesKeywordTrigger(message, {
        keywords: ['pickup'],
        match_type: 'exact',
      }),
    ).toBe(false)
    expect(
      messageMatchesKeywordTrigger(message, {
        keywords: [message],
        match_type: 'exact',
      }),
    ).toBe(true)
  })

  it('does not match schedule pickup when message has an extra "a"', () => {
    expect(
      messageMatchesKeywordTrigger(message, {
        keywords: ['schedule pickup'],
        match_type: 'contains',
      }),
    ).toBe(false)
  })

  it('parses comma-separated keywords stored as a string', () => {
    expect(
      messageMatchesKeywordTrigger(message, {
        keywords: 'schedule, pickup',
        match_type: 'contains',
      }),
    ).toBe(true)
  })
})
