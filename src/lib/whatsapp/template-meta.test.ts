import { describe, expect, it } from 'vitest'
import {
  buildCreateTemplateComponents,
  categoryToMeta,
  normalizeTemplateName,
  statusAfterMetaCreate,
} from './template-meta'

describe('normalizeTemplateName', () => {
  it('lowercases and replaces spaces with underscores', () => {
    expect(normalizeTemplateName('Welcome Message')).toBe('welcome_message')
  })

  it('strips invalid characters', () => {
    expect(normalizeTemplateName('hello-world!')).toBe('helloworld')
  })
})

describe('categoryToMeta', () => {
  it('maps CRM categories to Meta enums', () => {
    expect(categoryToMeta('Utility')).toBe('UTILITY')
    expect(categoryToMeta('Marketing')).toBe('MARKETING')
  })
})

describe('statusAfterMetaCreate', () => {
  it('defaults to Pending when Meta omits status', () => {
    expect(statusAfterMetaCreate({})).toBe('Pending')
  })

  it('maps APPROVED from Meta', () => {
    expect(statusAfterMetaCreate({ status: 'APPROVED' })).toBe('Approved')
  })
})

describe('buildCreateTemplateComponents', () => {
  it('builds body and optional footer', () => {
    const c = buildCreateTemplateComponents({
      body_text: 'Hi {{1}}',
      footer_text: 'Thanks',
    })
    expect(c).toHaveLength(2)
    expect(c[0]).toEqual({ type: 'BODY', text: 'Hi {{1}}' })
    expect(c[1]).toEqual({ type: 'FOOTER', text: 'Thanks' })
  })

  it('includes text header when provided', () => {
    const c = buildCreateTemplateComponents({
      body_text: 'Body',
      header_type: 'text',
      header_content: 'Title',
    })
    expect(c[0]).toEqual({
      type: 'HEADER',
      format: 'TEXT',
      text: 'Title',
    })
  })
})
