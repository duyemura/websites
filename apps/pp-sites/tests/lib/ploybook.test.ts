import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerEnrichment, triggerEdit } from '../../src/lib/ploybook.js'
import type { GymProfile } from '../../src/types.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const profile: GymProfile = {
  name: 'CrossFit Test',
  address: '123 Main St, Austin, TX 78701',
  phone: '512-555-0100',
  hours: { monday: '6am-8pm' },
  classTypes: ['CrossFit'],
  planNames: ['Unlimited'],
  memberCount: 142,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['PLOY_ENRICH_WEBHOOK_URL'] = 'https://ploy.ai/webhooks/enrich-test'
  process.env['PLOY_EDIT_WEBHOOK_URL'] = 'https://ploy.ai/webhooks/edit-test'
})

describe('triggerEnrichment', () => {
  it('POSTs gym profile to enrichment webhook', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'queued' }) })
    await triggerEnrichment('company_abc', profile)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://ploy.ai/webhooks/enrich-test',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: expect.stringContaining('"pushpressCompanyId":"company_abc"'),
      })
    )
  })

  it('throws if PLOY_ENRICH_WEBHOOK_URL is not set', async () => {
    delete process.env['PLOY_ENRICH_WEBHOOK_URL']
    await expect(triggerEnrichment('company_abc', profile)).rejects.toThrow(
      'PLOY_ENRICH_WEBHOOK_URL'
    )
  })
})

describe('triggerEdit', () => {
  it('POSTs instruction to edit webhook and returns preview URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ previewUrl: 'https://preview.ploy.ai/xyz' }),
    })
    const result = await triggerEdit('company_abc', 'Update pricing page')
    expect(result).toBe('https://preview.ploy.ai/xyz')
  })
})
