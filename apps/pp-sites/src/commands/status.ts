import { workspaceUse, siteStatus } from '../lib/ploy.js'
import type { SiteStatus } from '../types.js'

export async function getSiteStatus(
  workspaceId: string,
  pushpressCompanyId: string
): Promise<SiteStatus> {
  await workspaceUse(workspaceId)
  const raw = await siteStatus()

  let parsed: Partial<SiteStatus> = {}
  try {
    parsed = JSON.parse(raw) as Partial<SiteStatus>
  } catch {
    parsed = { state: 'status-unavailable' }
  }

  const status: SiteStatus = {
    companyId: pushpressCompanyId,
    workspaceId,
    siteId: parsed.siteId ?? '',
    state: parsed.state ?? 'status-unavailable',
    url: parsed.url,
  }

  console.log(
    `Status for ${pushpressCompanyId}: ${status.state}${status.url ? ` — ${status.url}` : ''}`
  )
  return status
}
