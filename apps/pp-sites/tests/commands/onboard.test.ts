import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/ploy.js', () => ({
  workspaceUse: vi.fn().mockResolvedValue(undefined),
  siteInit: vi.fn().mockResolvedValue('{"id":"site_1","previewUrl":"https://preview.ploy.ai/1"}'),
  sitePublish: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/lib/pushpress.js', () => ({
  getGymProfile: vi.fn().mockResolvedValue({
    name: 'CrossFit Test',
    address: '123 Main St, Austin TX',
    phone: '512-555-0100',
    hours: {},
    classTypes: ['CrossFit'],
    planNames: ['Unlimited'],
    memberCount: 100,
  }),
}))

vi.mock('../../src/lib/ploybook.js', () => ({
  triggerEnrichment: vi.fn().mockResolvedValue(undefined),
}))

import { onboardSingleGym } from '../../src/commands/onboard.js'
import { workspaceUse, siteInit, sitePublish } from '../../src/lib/ploy.js'
import { getGymProfile } from '../../src/lib/pushpress.js'
import { triggerEnrichment } from '../../src/lib/ploybook.js'
import type { GymRecord } from '../../src/types.js'

const gym: GymRecord = {
  gymName: 'CrossFit Test',
  websiteUrl: 'https://crossfittest.com',
  pushpressCompanyId: 'company_abc',
  ployWorkspaceId: 'ws_111',
}

beforeEach(() => vi.clearAllMocks())

describe('onboardSingleGym', () => {
  it('runs full pipeline: workspaceUse → siteInit → getGymProfile → triggerEnrichment → sitePublish', async () => {
    const result = await onboardSingleGym(gym)

    expect(workspaceUse).toHaveBeenCalledWith('ws_111')
    expect(siteInit).toHaveBeenCalledWith('https://crossfittest.com')
    expect(getGymProfile).toHaveBeenCalledWith('company_abc')
    expect(triggerEnrichment).toHaveBeenCalledWith(
      'company_abc',
      expect.objectContaining({ name: 'CrossFit Test' })
    )
    expect(sitePublish).toHaveBeenCalled()
    expect(result.status).toBe('success')
  })

  it('returns failed status when siteInit throws', async () => {
    vi.mocked(siteInit).mockRejectedValueOnce(new Error('ploy slurp timed out'))
    const result = await onboardSingleGym(gym)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('ploy slurp timed out')
  })
})
