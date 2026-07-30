import { execa } from 'execa'

export async function workspaceUse(workspaceId: string): Promise<void> {
  await execa('ploy', ['workspace', 'use', '--id', workspaceId], { stdio: 'pipe' })
}

export async function siteInit(websiteUrl: string): Promise<string> {
  const { stdout } = await execa(
    'ploy',
    ['site', 'init', '--slurp', websiteUrl, '--wait', '--json'],
    { stdio: 'pipe' }
  )
  return stdout.trim()
}

export async function sitePublish(): Promise<void> {
  await execa('ploy', ['site', 'publish', '--wait'], { stdio: 'pipe' })
}

export async function siteList(): Promise<Array<{ id: string; name: string }>> {
  const { stdout } = await execa('ploy', ['site', 'list', '--json'], { stdio: 'pipe' })
  return JSON.parse(stdout) as Array<{ id: string; name: string }>
}

export async function siteUse(siteId: string): Promise<void> {
  await execa('ploy', ['site', 'use', '--id', siteId], { stdio: 'pipe' })
}

export async function siteStatus(): Promise<string> {
  const { stdout } = await execa('ploy', ['site', 'status', '--json'], { stdio: 'pipe' })
  return stdout.trim()
}
