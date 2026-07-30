import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/lib/ploy.js', () => ({
  workspaceUse: vi.fn().mockResolvedValue(undefined),
  siteList: vi.fn().mockResolvedValue([{ id: 'site_1', name: 'CrossFit Test' }]),
  siteUse: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/lib/ploybook.js', () => ({
  triggerEdit: vi.fn().mockResolvedValue('https://preview.ploy.ai/abc123'),
}))

import { editSite } from '../../src/commands/edit.js'
import { workspaceUse } from '../../src/lib/ploy.js'
import { triggerEdit } from '../../src/lib/ploybook.js'

beforeEach(() => vi.clearAllMocks())

describe('editSite', () => {
  it('sets workspace context and triggers edit Ploybook', async () => {
    const previewUrl = await editSite('ws_111', 'company_abc', 'Update pricing page')
    expect(workspaceUse).toHaveBeenCalledWith('ws_111')
    expect(triggerEdit).toHaveBeenCalledWith('company_abc', 'Update pricing page')
    expect(previewUrl).toBe('https://preview.ploy.ai/abc123')
  })
})
