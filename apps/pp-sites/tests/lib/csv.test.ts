import { describe, it, expect } from 'vitest'
import { parseGymsCSV } from '../../src/lib/csv.js'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('parseGymsCSV', () => {
  it('parses a valid CSV into GymRecord array', async () => {
    const csvPath = join(tmpdir(), 'test-gyms.csv')
    writeFileSync(
      csvPath,
      `gym_name,website_url,pushpress_company_id,ploy_workspace_id
CrossFit Test,https://crossfittest.com,company_abc,ws_111
Iron Athletics,https://ironathletics.com,company_def,ws_222
`
    )
    const records = await parseGymsCSV(csvPath)
    expect(records).toHaveLength(2)
    expect(records[0]).toEqual({
      gymName: 'CrossFit Test',
      websiteUrl: 'https://crossfittest.com',
      pushpressCompanyId: 'company_abc',
      ployWorkspaceId: 'ws_111',
    })
    unlinkSync(csvPath)
  })

  it('skips rows with missing required fields', async () => {
    const csvPath = join(tmpdir(), 'test-gyms-bad.csv')
    writeFileSync(
      csvPath,
      `gym_name,website_url,pushpress_company_id,ploy_workspace_id
Good Gym,https://goodgym.com,company_abc,ws_111
,https://missing-name.com,company_def,ws_222
`
    )
    const records = await parseGymsCSV(csvPath)
    expect(records).toHaveLength(1)
    unlinkSync(csvPath)
  })
})
