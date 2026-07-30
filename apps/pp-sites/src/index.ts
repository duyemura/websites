import { Command } from 'commander'
import { onboardSingleGym, onboardFromCSV } from './commands/onboard.js'
import { editSite } from './commands/edit.js'
import { getSiteStatus } from './commands/status.js'

const program = new Command()

program
  .name('pp-sites')
  .description('PushPress gym site management CLI')
  .version('0.0.1')

program
  .command('onboard')
  .description('Onboard a gym to Ploy (single or bulk CSV)')
  .option('--company <id>', 'PushPress company ID (single gym)')
  .option('--url <url>', 'Gym website URL to import (single gym)')
  .option('--workspace <id>', 'Ploy workspace ID (single gym, PoC workaround)')
  .option('--name <name>', 'Gym name (single gym)')
  .option('--csv <path>', 'Path to CSV file for bulk onboarding')
  .option('--concurrency <n>', 'Max parallel onboards (bulk only)', '5')
  .action(
    async (opts: {
      company?: string
      url?: string
      workspace?: string
      name?: string
      csv?: string
      concurrency: string
    }) => {
      if (opts.csv) {
        await onboardFromCSV(opts.csv, parseInt(opts.concurrency))
      } else if (opts.company && opts.url && opts.workspace && opts.name) {
        await onboardSingleGym({
          gymName: opts.name,
          websiteUrl: opts.url,
          pushpressCompanyId: opts.company,
          ployWorkspaceId: opts.workspace,
        })
      } else {
        console.error('Provide either --csv or all of --company, --url, --workspace, --name')
        process.exit(1)
      }
    }
  )

program
  .command('edit')
  .description('Edit a gym site via Ploy AI agent')
  .requiredOption('--company <id>', 'PushPress company ID')
  .requiredOption('--workspace <id>', 'Ploy workspace ID')
  .argument('<instruction>', 'Edit instruction for the AI agent')
  .action(async (instruction: string, opts: { company: string; workspace: string }) => {
    await editSite(opts.workspace, opts.company, instruction)
  })

program
  .command('status')
  .description('Check site status for a gym')
  .requiredOption('--company <id>', 'PushPress company ID')
  .requiredOption('--workspace <id>', 'Ploy workspace ID')
  .action(async (opts: { company: string; workspace: string }) => {
    await getSiteStatus(opts.workspace, opts.company)
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
