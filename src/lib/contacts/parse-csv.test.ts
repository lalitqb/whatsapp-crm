import { describe, expect, it } from 'vitest'
import { parseContactsCsv } from './parse-csv'

describe('parseContactsCsv', () => {
  it('skips a leading blank row and parses phone/name columns', () => {
    const csv = `,,,,,
ID,name,phone,TAGS,SOURCE,RECENT ORDER
2839904,PRASHANT,8092161029,,OUR STORE,2026-05-26
2836296,SHREYA,7992356352,,OUR STORE,2026-05-24`

    const rows = parseContactsCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'PRASHANT', phone: '918092161029' })
    expect(rows[1]).toMatchObject({ name: 'SHREYA', phone: '917992356352' })
  })

  it('returns empty when no phone column exists', () => {
    expect(parseContactsCsv('a,b,c\n1,2,3')).toEqual([])
  })
})
