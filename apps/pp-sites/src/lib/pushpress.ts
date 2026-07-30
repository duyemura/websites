import type { GymProfile } from '../types.js'

interface CompanyResponse {
  name: string
  address: { street: string; city: string; state: string; zip: string }
  phone: string
  hours: Record<string, string>
  classTypes: string[]
  plans: Array<{ name: string }>
  memberCount: number
}

export async function getGymProfile(companyId: string): Promise<GymProfile> {
  const apiKey = process.env['PUSHPRESS_API_KEY']
  if (!apiKey) throw new Error('PUSHPRESS_API_KEY environment variable is required')

  const server = process.env['PUSHPRESS_SERVER'] ?? 'api.pushpress.com'
  const res = await fetch(`https://${server}/v3/company`, {
    headers: {
      'API-KEY': apiKey,
      'company-id': companyId,
    },
  })

  if (!res.ok) {
    throw new Error(`PushPress API error ${res.status} for company ${companyId}`)
  }

  const data = (await res.json()) as CompanyResponse
  return {
    name: data.name,
    address: `${data.address.street}, ${data.address.city}, ${data.address.state} ${data.address.zip}`,
    phone: data.phone,
    hours: data.hours,
    classTypes: data.classTypes,
    planNames: data.plans.map((p) => p.name),
    memberCount: data.memberCount,
  }
}
