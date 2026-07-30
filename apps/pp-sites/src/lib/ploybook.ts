import type { GymProfile } from '../types.js'

export async function triggerEnrichment(
  pushpressCompanyId: string,
  profile: GymProfile
): Promise<void> {
  const webhookUrl = process.env['PLOY_ENRICH_WEBHOOK_URL']
  if (!webhookUrl) throw new Error('PLOY_ENRICH_WEBHOOK_URL environment variable is required')

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pushpressCompanyId, profile }),
  })

  if (!res.ok) {
    throw new Error(`Enrichment Ploybook webhook failed: ${res.status}`)
  }
}

export async function triggerEdit(
  pushpressCompanyId: string,
  instruction: string
): Promise<string> {
  const webhookUrl = process.env['PLOY_EDIT_WEBHOOK_URL']
  if (!webhookUrl) throw new Error('PLOY_EDIT_WEBHOOK_URL environment variable is required')

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pushpressCompanyId, instruction }),
  })

  if (!res.ok) {
    throw new Error(`Edit Ploybook webhook failed: ${res.status}`)
  }

  const data = (await res.json()) as { previewUrl?: string }
  return data.previewUrl ?? ''
}
