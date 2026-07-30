import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/ploy.js', () => ({
  workspaceUse: vi.fn().mockResolvedValue(undefined),
  siteStatus: vi.fn().mockResolvedValue('{"state":"ready","url":"https://crossfittest.ploy.ai"}'),
}))

import { getSiteStatus } from '../../src/commands/status.js'
import { workspaceUse, siteStatus } from '../../src/lib/ploy.js'

beforeEach(() => vi.clearAllMocks())

describe('getSiteStatus', () => {
  it('uses workspace then returns parsed status', async () => {
    const status = await getSiteStatus('ws_111', 'company_abc')
    expect(workspaceUse).toHaveBeenCalledWith('ws_111')
    expect(siteStatus).toHaveBeenCalled()
    expect(status.state).toBe('ready')
    expect(status.url).toBe('https://crossfittest.ploy.ai')
  })
})
