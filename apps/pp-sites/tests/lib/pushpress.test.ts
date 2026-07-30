import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getGymProfile } from '../../src/lib/pushpress.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  vi.clearAllMocks()
  process.env['PUSHPRESS_API_KEY'] = 'test-key'
  process.env['PUSHPRESS_SERVER'] = 'api.pushpressdev.com'
})

describe('getGymProfile', () => {
  it('fetches gym profile and maps it to GymProfile', async () => {
    const apiResponse = {
      name: 'CrossFit Test',
      address: { street: '123 Main St', city: 'Austin', state: 'TX', zip: '78701' },
      phone: '512-555-0100',
      hours: { monday: '6am-8pm', tuesday: '6am-8pm' },
      classTypes: ['CrossFit', 'Weightlifting'],
      plans: [{ name: 'Unlimited' }, { name: 'Punch Card' }],
      memberCount: 142,
    }
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => apiResponse,
    })

    const profile = await getGymProfile('company_abc')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.pushpressdev.com/v3/company',
      expect.objectContaining({
        headers: expect.objectContaining({ 'API-KEY': 'test-key', 'company-id': 'company_abc' }),
      })
    )
    expect(profile.name).toBe('CrossFit Test')
    expect(profile.phone).toBe('512-555-0100')
    expect(profile.planNames).toEqual(['Unlimited', 'Punch Card'])
    expect(profile.memberCount).toBe(142)
  })

  it('throws if PUSHPRESS_API_KEY is not set', async () => {
    delete process.env['PUSHPRESS_API_KEY']
    await expect(getGymProfile('company_abc')).rejects.toThrow('PUSHPRESS_API_KEY')
  })
})
