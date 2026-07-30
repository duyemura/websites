import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('execa')

import { workspaceUse, siteInit, sitePublish, siteList } from '../../src/lib/ploy.js'
import { execa } from 'execa'

const mockExeca = vi.mocked(execa)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('workspaceUse', () => {
  it('runs ploy workspace use with the given id', async () => {
    mockExeca.mockResolvedValue({ stdout: '', stderr: '' } as any)
    await workspaceUse('ws_abc123')
    expect(mockExeca).toHaveBeenCalledWith('ploy', ['workspace', 'use', '--id', 'ws_abc123'], {
      stdio: 'pipe',
    })
  })
})

describe('siteInit', () => {
  it('runs ploy site init --slurp with the given url and returns stdout', async () => {
    mockExeca.mockResolvedValue({ stdout: 'site_xyz789', stderr: '' } as any)
    const result = await siteInit('https://example.com')
    expect(mockExeca).toHaveBeenCalledWith(
      'ploy',
      ['site', 'init', '--slurp', 'https://example.com', '--wait', '--json'],
      { stdio: 'pipe' }
    )
    expect(result).toBe('site_xyz789')
  })
})

describe('sitePublish', () => {
  it('runs ploy site publish --wait', async () => {
    mockExeca.mockResolvedValue({ stdout: '', stderr: '' } as any)
    await sitePublish()
    expect(mockExeca).toHaveBeenCalledWith('ploy', ['site', 'publish', '--wait'], {
      stdio: 'pipe',
    })
  })
})

describe('siteList', () => {
  it('runs ploy site list and returns parsed JSON', async () => {
    const sites = [{ id: 'site_1', name: 'Test Gym' }]
    mockExeca.mockResolvedValue({ stdout: JSON.stringify(sites), stderr: '' } as any)
    const result = await siteList()
    expect(mockExeca).toHaveBeenCalledWith('ploy', ['site', 'list', '--json'], { stdio: 'pipe' })
    expect(result).toEqual(sites)
  })
})
