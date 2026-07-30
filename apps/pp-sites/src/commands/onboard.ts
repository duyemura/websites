import pLimit from 'p-limit'
import { workspaceUse, siteInit, sitePublish } from '../lib/ploy.js'
import { getGymProfile } from '../lib/pushpress.js'
import { triggerEnrichment } from '../lib/ploybook.js'
import { parseGymsCSV } from '../lib/csv.js'
import type { GymRecord, OnboardResult } from '../types.js'

export async function onboardSingleGym(gym: GymRecord): Promise<OnboardResult> {
  try {
    console.log(`[${gym.gymName}] Setting workspace...`)
    await workspaceUse(gym.ployWorkspaceId)

    console.log(`[${gym.gymName}] Slurping site (may take up to 15 min)...`)
    const siteJson = await siteInit(gym.websiteUrl)

    let siteId: string | undefined
    try {
      const parsed = JSON.parse(siteJson) as { id?: string }
      siteId = parsed.id
    } catch {
      // stdout may not be JSON on all ploy versions
    }

    console.log(`[${gym.gymName}] Fetching PushPress data...`)
    const profile = await getGymProfile(gym.pushpressCompanyId)

    console.log(`[${gym.gymName}] Triggering enrichment Ploybook...`)
    await triggerEnrichment(gym.pushpressCompanyId, profile)

    console.log(`[${gym.gymName}] Publishing...`)
    await sitePublish()

    console.log(`[${gym.gymName}] Done.`)
    return { gymRecord: gym, status: 'success', siteId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[${gym.gymName}] FAILED: ${message}`)
    return { gymRecord: gym, status: 'failed', error: message }
  }
}

export async function onboardFromCSV(csvPath: string, concurrency = 5): Promise<void> {
  const gyms = await parseGymsCSV(csvPath)
  console.log(`Onboarding ${gyms.length} gyms (concurrency: ${concurrency})...`)

  const limit = pLimit(concurrency)
  const results = await Promise.all(gyms.map((gym) => limit(() => onboardSingleGym(gym))))

  const succeeded = results.filter((r) => r.status === 'success')
  const failed = results.filter((r) => r.status === 'failed')

  console.log(`\nDone. ${succeeded.length} succeeded, ${failed.length} failed.`)

  if (failed.length > 0) {
    console.log('\nRetry commands for failures:')
    for (const f of failed) {
      console.log(
        `  pp-sites onboard --company ${f.gymRecord.pushpressCompanyId} --url ${f.gymRecord.websiteUrl}`
      )
    }
  }
}
