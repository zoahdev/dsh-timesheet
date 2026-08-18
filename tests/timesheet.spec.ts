import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseSessionLog, timesheet, renderTimesheet } from '../src/timesheet.js'

const SESSION_META = {
  type: 'session_meta',
  payload: {
    session_id: 's1', cwd: '/home/u/proj-a', model_provider: 'custom', source: 'desktop',
  },
}

function started(turnId: string, epoch: number) {
  return { type: 'event_msg', payload: { type: 'task_started', turn_id: turnId, started_at: epoch } }
}

function complete(turnId: string, durationMs: number, opts: { ttftMs?: number; error?: { message: string } } = {}) {
  return {
    type: 'event_msg',
    payload: {
      type: 'task_complete', turn_id: turnId, started_at: 0, completed_at: durationMs,
      duration_ms: durationMs, time_to_first_token_ms: opts.ttftMs ?? null,
      error: opts.error ?? null,
    },
  }
}

function call(name: string) {
  return { type: 'response_item', payload: { type: 'function_call', name } }
}

describe('parseSessionLog', () => {
  it('pairs task_started/task_complete into turn records', () => {
    const lines = [
      JSON.stringify(SESSION_META),
      JSON.stringify(started('t1', 1_700_000_000)),
      JSON.stringify(complete('t1', 12_000, { ttftMs: 900 })),
      JSON.stringify(call('bash')),
      JSON.stringify(call('read_file')),
      JSON.stringify(started('t2', 1_700_000_100)),
      JSON.stringify(complete('t2', 8_000, { error: { message: 'boom' } })),
    ]
    const parsed = parseSessionLog(lines.join('\n'), 's1', 's1.jsonl')
    expect(parsed.turns).toHaveLength(2)
    expect(parsed.toolCalls).toBe(2)
    expect(parsed.turns[0]?.durationMs).toBe(12_000)
    expect(parsed.turns[0]?.ttftMs).toBe(900)
    expect(parsed.turns[0]?.project).toBe('proj-a')
    expect(parsed.turns[0]?.provider).toBe('custom')
    expect(parsed.turns[0]?.source).toBe('desktop')
    expect(parsed.turns[1]?.failed).toBe(true)
    expect(parsed.turns[1]?.error).toBe('boom')
  })

  it('ignores malformed lines', () => {
    const parsed = parseSessionLog('not json\n{"type":"event_msg","payload":{"type":"task_started","turn_id":"t1","started_at":1700000000}}\n{"type":"event_msg","payload":{"type":"task_complete","turn_id":"t1","duration_ms":500}}\n', 's1', 's1.jsonl')
    expect(parsed.turns).toHaveLength(1)
    expect(parsed.turns[0]?.durationMs).toBe(500)
  })

  it('drops unmatched starts', () => {
    const parsed = parseSessionLog(JSON.stringify(started('orphan', 1_700_000_000)), 's1', 's1.jsonl')
    expect(parsed.turns).toHaveLength(0)
  })
})

describe('timesheet', () => {
  function makeLogFile(dir: string, name: string, lines: string[]) {
    writeFileSync(path.join(dir, name), lines.join('\n'), 'utf8')
  }

  it('rolls up by day/project/provider/source', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-timesheet-'))
    try {
      makeLogFile(dir, 'a.jsonl', [
        JSON.stringify({ ...SESSION_META, payload: { ...SESSION_META.payload, cwd: '/home/u/proj-a' } }),
        JSON.stringify(started('t1', 1_700_000_000)),
        JSON.stringify(complete('t1', 60_000)),
        JSON.stringify(call('bash')),
      ])
      makeLogFile(dir, 'b.jsonl', [
        JSON.stringify({ ...SESSION_META, payload: { ...SESSION_META.payload, cwd: '/home/u/proj-b' } }),
        JSON.stringify(started('t2', 1_700_000_100)),
        JSON.stringify(complete('t2', 30_000, { error: { message: 'fail' } })),
      ])
      const result = await timesheet(dir)
      expect(result.schema).toBe('dsh-timesheet/v1')
      expect(result.turns).toBe(2)
      expect(result.sessions).toBe(2)
      expect(result.totalDurationMs).toBe(90_000)
      expect(result.failedTurns).toBe(1)
      expect(result.toolCalls).toBe(1)
      expect(result.byDay[0]?.turns).toBe(2)
      expect(result.byProject.map((r) => r.key)).toContain('proj-a')
      expect(result.byProject.map((r) => r.key)).toContain('proj-b')
      expect(result.byProvider[0]?.key).toBe('custom')
      expect(result.bySource[0]?.key).toBe('desktop')
      expect(result.ok).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('warns when no session logs are found', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-timesheet-empty-'))
    try {
      const result = await timesheet(dir)
      expect(result.ok).toBe(false)
      expect(result.warnings.some((w) => w.includes('No *.jsonl session logs'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns an error envelope for unreadable directories', async () => {
    const result = await timesheet(path.join(tmpdir(), 'does-not-exist-xyz'))
    expect(result.ok).toBe(false)
    expect(result.warnings[0]).toContain('cannot read directory')
  })
})

describe('renderTimesheet', () => {
  it('renders markdown tables and the summary line', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dsh-timesheet-render-'))
    try {
      writeFileSync(path.join(dir, 'a.jsonl'), JSON.stringify(SESSION_META) + '\n' + JSON.stringify(started('t1', 1_700_000_000)) + '\n' + JSON.stringify(complete('t1', 12_000)) + '\n', 'utf8')
      const result = await timesheet(dir)
      const text = renderTimesheet(result).join('\n')
      expect(text).toContain('dsh-timesheet — 1 turns')
      expect(text).toContain('## By day')
      expect(text).toContain('| Key | Turns | Time |')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})