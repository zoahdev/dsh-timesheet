/**
 * dsh-timesheet — turn-based time tracking for DeepSeek Harness.
 * @module dsh-timesheet
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import { satisfiesCaret } from './version.js'
import { timesheet, renderTimesheet, type TimesheetResult } from './timesheet.js'

export const name = 'dsh-timesheet'

export const inject = ['tools']

export const TESTED_PEER_RANGE = '^0.1.0-rc.6'

const require = createRequire(import.meta.url)

export function resolvedDshToolsVersion(): string {
  try {
    const pkg = require('@deepseek-ai/dsh-tools/package.json') as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unresolved'
  }
}

export function assertPeerCompatible(): void {
  const version = resolvedDshToolsVersion()
  if (!satisfiesCaret(version, TESTED_PEER_RANGE)) {
    throw new Error(
      `dsh-timesheet: resolved @deepseek-ai/dsh-tools ${version}, but this plugin is tested with `
      + `${TESTED_PEER_RANGE}. Upgrade DeepSeek Harness to 0.1.0-rc.6 or later, then reinstall this plugin.`,
    )
  }
}

export interface Config {
  defaultDir?: string
}

export const Config: Schema<Config> = Schema.object({
  defaultDir: Schema.string().default(''),
})

export function apply(ctx: Context, config: Config): void {
  assertPeerCompatible()
  ctx.tools.register(defineTool({
    name: 'timesheet',
    description:
      'Build a time-tracking report from DeepSeek Harness session logs (*.jsonl): totals, per-day, '
      + 'per-project, per-provider and per-source rollups, tool-call counts, failure rates, and '
      + 'time-to-first-token. Pass a directory containing session logs (defaults to the configured '
      + 'defaultDir). Returns a dsh-timesheet/v1 report.',
    parameters: {
      dir: { type: 'string', description: 'Directory containing *.jsonl session logs' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          schema: { type: 'string' },
          target: { type: 'string' },
          ok: { type: 'boolean' },
          scannedFiles: { type: 'number' },
          sessions: { type: 'number' },
          turns: { type: 'number' },
          totalDurationMs: { type: 'number' },
          failedTurns: { type: 'number' },
          toolCalls: { type: 'number' },
          byDay: { type: 'array' },
          byProject: { type: 'array' },
          byProvider: { type: 'array' },
          bySource: { type: 'array' },
          latest: { type: 'json' },
          warnings: { type: 'array' },
        },
      },
      render: (_args, value) => renderTimesheet(value as unknown as TimesheetResult).map((text) => ({ type: 'text' as const, text })),
    },
    async execute(args, _exec): Promise<TimesheetResult> {
      const dir: string = (args.dir ?? '').trim() !== '' ? (args.dir as string) : (config.defaultDir ?? '')
      if (dir === '') {
        throw new Error('dsh-timesheet: no directory given — pass dir or configure defaultDir')
      }
      return timesheet(dir)
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Timesheet: ${args.dir ?? config.defaultDir}`,
      kind: 'other',
      rawInput: args,
    }),
  }))
}