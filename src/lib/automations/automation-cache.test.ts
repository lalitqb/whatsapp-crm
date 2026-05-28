import { describe, expect, it } from 'vitest'
import { filterAutomationSteps } from '@/lib/automations/automation-cache'
import type { AutomationStep } from '@/types'

function step(
  partial: Pick<AutomationStep, 'id' | 'position' | 'parent_step_id' | 'branch'> &
    Partial<AutomationStep>,
): AutomationStep {
  return {
    automation_id: 'a1',
    step_type: 'send_message',
    step_config: { text: 'hi' },
    created_at: '',
    updated_at: '',
    ...partial,
  } as AutomationStep
}

describe('filterAutomationSteps', () => {
  const all = [
    step({ id: '1', position: 0, parent_step_id: null, branch: null }),
    step({ id: '2', position: 1, parent_step_id: null, branch: null }),
    step({ id: '3', position: 0, parent_step_id: 'c1', branch: 'yes' }),
    step({ id: '4', position: 0, parent_step_id: 'c1', branch: 'no' }),
  ]

  it('returns root steps from startPosition', () => {
    const out = filterAutomationSteps(all, null, null, 1)
    expect(out.map((s) => s.id)).toEqual(['2'])
  })

  it('filters condition branch steps', () => {
    const yes = filterAutomationSteps(all, 'c1', 'yes', 0)
    const no = filterAutomationSteps(all, 'c1', 'no', 0)
    expect(yes.map((s) => s.id)).toEqual(['3'])
    expect(no.map((s) => s.id)).toEqual(['4'])
  })
})
