export interface GymRecord {
  gymName: string
  websiteUrl: string
  pushpressCompanyId: string
  ployWorkspaceId: string // PoC workaround — remove when `ploy workspace create` ships
}

export interface GymProfile {
  name: string
  address: string
  phone: string
  hours: Record<string, string>
  classTypes: string[]
  planNames: string[]
  memberCount: number
}

export interface OnboardResult {
  gymRecord: GymRecord
  status: 'success' | 'failed'
  siteId?: string
  previewUrl?: string
  error?: string
}

export interface SiteStatus {
  companyId: string
  workspaceId: string
  siteId: string
  state: 'pending' | 'ready' | 'failed' | 'status-unavailable'
  url?: string
}
