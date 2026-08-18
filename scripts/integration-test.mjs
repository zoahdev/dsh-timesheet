#!/usr/bin/env node
/**
 * Packaged integration + real runtime invocation smoke test.
 * Installs the packed tarball, loads the bundle, registers timesheet,
 * executes it against a fixture session-log directory, and asserts render.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tgz = path.resolve(process.argv[2] ?? path.join(root, 'dsh-timesheet-0.1.0.tgz'))

if (!existsSync(tgz)) {
  console.error(`[integration] missing tarball: ${tgz}`)
  process.exit(1)
}

function runPnpm(args, cwd) {
  if (process.platform === 'win32') {
    return spawnSync(`pnpm ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
  }
  return spawnSync('pnpm', args, { cwd, stdio: 'inherit' })
}

function makeFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-timesheet-target-'))
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 's1', cwd: '/home/u/proj', model_provider: 'custom', source: 'desktop' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1', started_at: 1700000000 } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', duration_ms: 12000, time_to_first_token_ms: 800, error: null } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'bash' } }),
  ]
  writeFileSync(path.join(dir, 'session.jsonl'), lines.join('\n'), 'utf8')
  return dir
}

async function scenario(name, dshToolsVersion, expectGuard) {
  const dir = mkdtempSync(path.join(tmpdir(), `dsh-timesheet-${name}-`))
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-timesheet-integration-host', private: true, version: '1.0.0',
    dependencies: {
      '@deepseek-ai/cordis': '^4.0.1',
      '@deepseek-ai/dsh-tools': dshToolsVersion,
      '@deepseek-ai/schemastery': '^3.18.1',
      'dsh-timesheet': `file:${tgz.replaceAll('\\', '/')}`,
    },
  }, null, 2))

  console.log(`[integration:${name}] installing packed tarball (dsh-tools ${dshToolsVersion})...`)
  const install = runPnpm(['install'], dir)
  if (install.status !== 0) { console.error(`[integration:${name}] pnpm install failed`); process.exit(1) }

  const pluginIndex = path.join(dir, 'node_modules', 'dsh-timesheet', 'lib', 'index.js')
  if (!existsSync(pluginIndex)) throw new Error('packed plugin entry lib/index.js missing after install')

  const plugin = await import(pathToFileURL(pluginIndex).href)
  if (plugin.name !== 'dsh-timesheet') throw new Error(`unexpected plugin name: ${plugin.name}`)

  const registered = []
  const ctx = { tools: { register: (definition) => { registered.push(definition); return () => {} } } }

  if (expectGuard) {
    let threw = false
    try { plugin.apply(ctx, { defaultDir: '' }) } catch (error) {
      threw = true
      if (!String(error instanceof Error ? error.message : error).includes('tested with ^0.1.0-rc.6')) {
        throw new Error(`guard threw an unexpected error: ${String(error)}`)
      }
    }
    if (!threw) throw new Error('runtime guard did not reject the incompatible dsh-tools version')
    console.log(`PASS [${name}] runtime guard rejected @deepseek-ai/dsh-tools ${dshToolsVersion}`)
    rmSync(dir, { recursive: true, force: true })
    return
  }

  plugin.apply(ctx, { defaultDir: '' })
  const tool = registered.find((definition) => definition.name === 'timesheet')
  if (tool === undefined) throw new Error('timesheet tool was not registered')

  const fixture = makeFixture()
  try {
    const result = await tool.execute({ dir: fixture }, { signal: new AbortController().signal })
    if (result?.schema !== 'dsh-timesheet/v1') throw new Error(`unexpected canonical result: ${JSON.stringify(result)}`)
    if (result.turns !== 1 || result.totalDurationMs !== 12000) {
      throw new Error(`unexpected rollup: ${JSON.stringify({ turns: result.turns, total: result.totalDurationMs })}`)
    }

    const blocks = tool.output.render({ dir: fixture }, result)
    const text = blocks.map((block) => block.text ?? '').join('\n')
    if (!text.includes('1 turns')) throw new Error(`render output missing summary: ${JSON.stringify(text)}`)

    console.log(`PASS [${name}] packed artifact loaded, timesheet registered, handler executed, render asserted`)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
}

await scenario('happy', '0.1.0-rc.6', false)
await scenario('guard', '0.1.0-rc.3', true)