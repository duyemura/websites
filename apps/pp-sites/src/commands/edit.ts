import { workspaceUse } from '../lib/ploy.js'
import { triggerEdit } from '../lib/ploybook.js'

export async function editSite(
  workspaceId: string,
  pushpressCompanyId: string,
  instruction: string
): Promise<string> {
  console.log(`Setting workspace ${workspaceId}...`)
  await workspaceUse(workspaceId)

  console.log(`Triggering edit: "${instruction}"`)
  const previewUrl = await triggerEdit(pushpressCompanyId, instruction)

  if (previewUrl) {
    console.log(`Preview: ${previewUrl}`)
  } else {
    console.log('Edit queued. Check Ploy dashboard for preview.')
  }

  return previewUrl
}
