import type { KeywordMatchTriggerConfig } from '@/types'

/** Split comma/semicolon/newline-separated keyword input. */
export function parseKeywordsInput(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function normalizeKeywordMatchConfig(
  config: Record<string, unknown> | KeywordMatchTriggerConfig | null | undefined,
): KeywordMatchTriggerConfig {
  const raw = (config ?? {}) as Record<string, unknown>
  let keywords: string[] = []
  if (Array.isArray(raw.keywords)) {
    keywords = raw.keywords.map(String).map((s) => s.trim()).filter(Boolean)
  } else if (typeof raw.keywords === 'string') {
    keywords = parseKeywordsInput(raw.keywords)
  }
  const match_type = raw.match_type === 'exact' ? 'exact' : 'contains'
  const case_sensitive = raw.case_sensitive === true
  return { keywords, match_type, case_sensitive }
}

/** Same as {@link normalizeKeywordMatchConfig}, as a plain object for builder state. */
export function normalizeKeywordMatchConfigRecord(
  config: Record<string, unknown> | KeywordMatchTriggerConfig | null | undefined,
): Record<string, unknown> {
  const cfg = normalizeKeywordMatchConfig(config)
  return {
    keywords: cfg.keywords,
    match_type: cfg.match_type,
    case_sensitive: cfg.case_sensitive ?? false,
  }
}

/** True when `messageText` satisfies a keyword_match trigger config. */
export function messageMatchesKeywordTrigger(
  messageText: string,
  config: Record<string, unknown> | KeywordMatchTriggerConfig | null | undefined,
): boolean {
  const cfg = normalizeKeywordMatchConfig(config)
  if (cfg.keywords.length === 0) return false
  const text = messageText.trim()
  if (!text) return false
  const haystack = cfg.case_sensitive ? text : text.toLowerCase()
  return cfg.keywords.some((raw) => {
    const k = cfg.case_sensitive ? raw : raw.toLowerCase()
    return cfg.match_type === 'exact' ? haystack === k : haystack.includes(k)
  })
}
