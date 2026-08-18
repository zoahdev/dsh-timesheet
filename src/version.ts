/** Minimal caret-range matching for the peer guard (subset of node-semver). */

export function parseVersion(input: string): { major: number; minor: number; patch: number; prerelease: string[] | null } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input.trim())
  if (match === null) return null
  const prerelease = match[4] !== undefined && match[4] !== '' ? match[4].split('.') : null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease }
}

function compareIdentifiers(a: string[], b: string[] | null): number {
  if (b === null) return 1
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

export function satisfiesCaret(version: string, range: string): boolean {
  const m = /^\^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(range.trim())
  if (m === null) return false
  const v = parseVersion(version)
  if (v === null) return false
  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3])
  const pre = m[4] !== undefined && m[4] !== '' ? m[4].split('.') : null
  if (v.major !== major || v.minor !== minor || v.patch < patch) return false
  if (v.patch === patch) {
    if (pre === null && v.prerelease !== null) return false
    if (pre !== null && compareIdentifiers(v.prerelease ?? [], pre) < 0) return false
  }
  if (major > 0) return v.major === major
  if (minor > 0) return v.minor === minor
  return v.patch === patch
}