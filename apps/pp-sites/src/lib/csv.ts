import { createReadStream } from 'node:fs'
import { parse } from 'csv-parse'
import type { GymRecord } from '../types.js'

export async function parseGymsCSV(filePath: string): Promise<GymRecord[]> {
  return new Promise((resolve, reject) => {
    const records: GymRecord[] = []
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on('data', (row: Record<string, string>) => {
        const gymName = row['gym_name'] ?? ''
        const websiteUrl = row['website_url'] ?? ''
        const pushpressCompanyId = row['pushpress_company_id'] ?? ''
        const ployWorkspaceId = row['ploy_workspace_id'] ?? ''
        if (gymName && websiteUrl && pushpressCompanyId && ployWorkspaceId) {
          records.push({ gymName, websiteUrl, pushpressCompanyId, ployWorkspaceId })
        }
      })
      .on('end', () => resolve(records))
      .on('error', reject)
  })
}
