/**
 * CLI entry for dsh-timesheet.
 *   dsh-timesheet <dir> [--json]
 * Exit: 0 ok, 1 no turns found / warnings, 2 usage/IO error.
 */

import { timesheet, renderTimesheet } from './timesheet.js'

function usage(): string {
  return [
    'dsh-timesheet — time tracking from DeepSeek Harness session logs',
    '',
    'Usage:',
    '  dsh-timesheet <dir> [--json]',
    '',
    'Options:',
    '  --json   print the machine-readable report',
    '  --help   show this help',
    '',
    'Example:',
    '  dsh-timesheet ~/.codex/sessions --json',
  ].join('\n')
}

export async function main(argv: string[]): Promise<number> {
  let dir: string | null = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--help': case '-h': process.stdout.write(usage() + '\n'); return 0
      case '--json': json = true; break
      default:
        if (arg.startsWith('-')) {
          process.stderr.write(`dsh-timesheet: unknown option ${arg}\n\n${usage()}\n`)
          return 2
        }
        if (dir !== null) {
          process.stderr.write(`dsh-timesheet: expected at most one directory\n\n${usage()}\n`)
          return 2
        }
        dir = arg
    }
  }
  if (dir === null) {
    process.stderr.write(`dsh-timesheet: missing directory\n\n${usage()}\n`)
    return 2
  }
  try {
    const result = await timesheet(dir)
    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else {
      process.stdout.write(renderTimesheet(result).join('\n') + '\n')
    }
    return result.ok ? 0 : 1
  } catch (error) {
    process.stderr.write(`dsh-timesheet: ${String(error instanceof Error ? error.message : error)}\n`)
    return 2
  }
}