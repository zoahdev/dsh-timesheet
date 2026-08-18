/**
 * Timesheet core for dsh-timesheet.
 *
 * Scans DeepSeek Harness session logs (*.jsonl) and builds time-tracking
 * rollups: totals, per-day, per-project, per-provider, per-source,
 * tool-call counts, failure rates, and time-to-first-token. Zero runtime
 * dependencies; reads session logs only.
 * @module dsh-timesheet/timesheet
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export type TurnRecord = {
  turnId: string
  sessionId: string
  cwd: string
  project: string
  provider: string
  source: string
  startedAt: string
  startedMs: number
  day: string
  durationMs: number
  ttftMs: number | null
  failed: boolean
  error: string | null
}

export type RollupRow = {
  key: string
  turns: number
  durationMs: number
  ttftMs: number | null
  failed: number
  avgMs: number
}

export type TimesheetResult = {
  schema: 'dsh-timesheet/v1'
  target: string
  ok: boolean
  scannedFiles: number
  sessions: number
  turns: number
  totalDurationMs: number
  failedTurns: number
  toolCalls: number
  byDay: RollupRow[]
  byProject: RollupRow[]
  byProvider: RollupRow[]
  bySource: RollupRow[]
  latest: TurnRecord | null
  warnings: string[]
}

interface Meta {
  session_id?: unknown
  cwd?: unknown
  model_provider?: unknown
  source?: unknown
}

interface TurnStart {
  type: 'task_started'
  turn_id?: unknown
  started_at?: unknown
}

interface TurnComplete {
  type: 'task_complete'
  turn_id?: unknown
  started_at?: unknown
  completed_at?: unknown
  duration_ms?: unknown
  time_to_first_token_ms?: unknown
  error?: { message?: unknown } | null
}

interface FunctionCall {
  type: 'function_call'
  name?: unknown
}

type EventPayload = Record<string, unknown> & (TurnStart | TurnComplete | Meta | FunctionCall | { type?: string })

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Parse a session log file into turn records + tool-call count. */
export function parseSessionLog(
  content: string,
  sessionId: string,
  fileName: string,
): { turns: TurnRecord[]; toolCalls: number; meta: { cwd: string | null; provider: string | null; source: string | null } } {
  const turns: TurnRecord[] = []
  let toolCalls = 0
  let metaCwd: string | null = null
  let metaProvider: string | null = null
  let metaSource: string | null = null

  const starts = new Map<string, { startedAt: string; startedMs: number; day: string }>()

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    let obj: { type?: unknown; payload?: EventPayload }
    try {
      obj = JSON.parse(line) as { type?: unknown; payload?: EventPayload }
    } catch {
      continue
    }
    if (typeof obj.type !== 'string') continue
    const payload = obj.payload
    if (payload === undefined || typeof payload !== 'object' || payload === null) continue

    const eventType = payload.type
    if (eventType === 'task_started') {
      const turnId = asString(payload.turn_id)
      const startedAt = asNumber(payload.started_at)
      if (turnId === null || startedAt === null) continue
      const startedMs = startedAt * 1000
      starts.set(turnId, { startedAt: new Date(startedMs).toISOString(), startedMs, day: new Date(startedMs).toISOString().slice(0, 10) })
      continue
    }
    if (eventType === 'task_complete') {
      const turnId = asString(payload.turn_id)
      if (turnId === null) continue
      const start = starts.get(turnId)
      const durationMs = asNumber(payload.duration_ms)
      const ttftMs = asNumber(payload.time_to_first_token_ms)
      if (durationMs === null) continue
      const failed = Boolean(payload.error)
      const error = typeof payload.error === 'object' && payload.error !== null
        ? asString((payload.error as { message?: unknown }).message)
        : null
      if (start !== undefined) {
        turns.push({
          turnId,
          sessionId,
          cwd: metaCwd ?? '',
          project: metaCwd !== null ? path.basename(metaCwd) : 'unknown',
          provider: metaProvider ?? 'unknown',
          source: metaSource ?? 'unknown',
          startedAt: start.startedAt,
          startedMs: start.startedMs,
          day: start.day,
          durationMs,
          ttftMs,
          failed,
          error,
        })
      }
      continue
    }
    if (eventType === 'function_call') {
      toolCalls += 1
      continue
    }
    if (obj.type === 'session_meta' && metaCwd === null) {
      metaCwd = asString(payload.cwd)
      metaProvider = asString(payload.model_provider)
      metaSource = asString(payload.source)
    }
  }

  return { turns, toolCalls, meta: { cwd: metaCwd, provider: metaProvider, source: metaSource } }
}

function rollup(rows: TurnRecord[], keyOf: (row: TurnRecord) => string): RollupRow[] {
  const map = new Map<string, { turns: number; durationMs: number; ttftMs: number | null; failed: number }>()
  for (const row of rows) {
    const key = keyOf(row)
    const bucket = map.get(key) ?? { turns: 0, durationMs: 0, ttftMs: null, failed: 0 }
    bucket.turns += 1
    bucket.durationMs += row.durationMs
    if (row.ttftMs !== null) {
      bucket.ttftMs = bucket.ttftMs === null ? row.ttftMs : bucket.ttftMs + row.ttftMs
    }
    if (row.failed) bucket.failed += 1
    map.set(key, bucket)
  }
  const out: RollupRow[] = []
  for (const [key, bucket] of map) {
    out.push({
      key,
      turns: bucket.turns,
      durationMs: bucket.durationMs,
      ttftMs: bucket.ttftMs,
      failed: bucket.failed,
      avgMs: Math.round(bucket.durationMs / bucket.turns),
    })
  }
  out.sort((a, b) => b.durationMs - a.durationMs)
  return out
}

async function listJsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path.join(dir, entry.name))
  }
  return files.sort()
}

function fmtDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Render a timesheet as Markdown text blocks. */
export function renderTimesheet(result: TimesheetResult): string[] {
  const lines: string[] = []
  lines.push(`dsh-timesheet — ${result.turns} turns / ${fmtDuration(result.totalDurationMs)} / ${result.failedTurns} failed / ${result.toolCalls} tool calls`)
  lines.push(`scanned ${result.scannedFiles} session file(s), ${result.sessions} session(s) in ${result.target}`)
  const tables: Array<[string, RollupRow[], (row: RollupRow) => string]> = [
    ['By day', result.byDay, (row) => row.key],
    ['By project', result.byProject, (row) => row.key],
    ['By provider', result.byProvider, (row) => row.key],
    ['By source', result.bySource, (row) => row.key],
  ]
  for (const [title, rows, _keyOf] of tables) {
    if (rows.length === 0) continue
    lines.push('')
    lines.push(`## ${title}`)
    lines.push('| Key | Turns | Time | Avg/turn | TTFT | Failed |')
    lines.push('|---|---|---|---|---|---|')
    for (const row of rows) {
      const ttft = row.ttftMs === null ? '—' : fmtDuration(row.ttftMs / row.turns)
      lines.push(`| ${row.key} | ${row.turns} | ${fmtDuration(row.durationMs)} | ${fmtDuration(row.avgMs)} | ${ttft} | ${row.failed} |`)
    }
  }
  for (const warning of result.warnings) lines.push(`~ ${warning}`)
  return lines
}

/** Build the timesheet for every *.jsonl session log in `dir`. */
export async function timesheet(dir: string): Promise<TimesheetResult> {
  const target = path.resolve(dir)
  const warnings: string[] = []
  const allTurns: TurnRecord[] = []
  const sessionIds = new Set<string>()
  let toolCalls = 0
  let scannedFiles = 0

  let files: string[]
  try {
    files = await listJsonlFiles(target)
  } catch (error) {
    return {
      schema: 'dsh-timesheet/v1',
      target,
      ok: false,
      scannedFiles: 0,
      sessions: 0,
      turns: 0,
      totalDurationMs: 0,
      failedTurns: 0,
      toolCalls: 0,
      byDay: [],
      byProject: [],
      byProvider: [],
      bySource: [],
      latest: null,
      warnings: [`cannot read directory: ${String(error instanceof Error ? error.message : error)}`],
    }
  }

  if (files.length === 0) {
    warnings.push('No *.jsonl session logs found in this directory (try ~/.codex/sessions, ~/.dsh, or your session log directory)')
  }

  for (const file of files) {
    try {
      const content = await readFile(file, 'utf8')
      const sessionId = path.basename(file)
      const parsed = parseSessionLog(content, sessionId, file)
      scannedFiles += 1
      sessionIds.add(sessionId)
      toolCalls += parsed.toolCalls
      for (const turn of parsed.turns) {
        if (turn.cwd === '') turn.cwd = parsed.meta.cwd ?? ''
        if (turn.project === 'unknown' && parsed.meta.cwd !== null) turn.project = path.basename(parsed.meta.cwd)
        if (turn.provider === 'unknown' && parsed.meta.provider !== null) turn.provider = parsed.meta.provider
        if (turn.source === 'unknown' && parsed.meta.source !== null) turn.source = parsed.meta.source
        allTurns.push(turn)
      }
    } catch (error) {
      warnings.push(`skipped ${file}: ${String(error instanceof Error ? error.message : error)}`)
    }
  }

  allTurns.sort((a, b) => a.startedMs - b.startedMs)
  const totalDurationMs = allTurns.reduce((sum, turn) => sum + turn.durationMs, 0)
  const failedTurns = allTurns.filter((turn) => turn.failed).length

  return {
    schema: 'dsh-timesheet/v1',
    target,
    ok: allTurns.length > 0,
    scannedFiles,
    sessions: sessionIds.size,
    turns: allTurns.length,
    totalDurationMs,
    failedTurns,
    toolCalls,
    byDay: rollup(allTurns, (row) => row.day),
    byProject: rollup(allTurns, (row) => row.project),
    byProvider: rollup(allTurns, (row) => row.provider),
    bySource: rollup(allTurns, (row) => row.source),
    latest: allTurns.length > 0 ? allTurns[allTurns.length - 1] : null,
    warnings,
  }
}