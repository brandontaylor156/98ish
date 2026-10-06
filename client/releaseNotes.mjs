// 98ish Update's "what's new": the feature merges of the last 60 days, from git.
// Builds read git when it's there (a local build, or a host with enough history) and fall
// back to client/release-notes.json, which `node releaseNotes.mjs` refreshes from git.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BASELINE = join(here, 'release-notes.json')
const DAYS = 60

// "Merge Casino 98: Texas Hold'em, ..." -> "Casino 98: Texas Hold'em, ..."; generic merges -> null
export const noteTitle = (subject) => {
  const s = String(subject || '').trim()
  if (!/^Merge\b/i.test(s)) return null
  if (/^Merge (branch|remote-tracking branch|pull request|commit)\b/i.test(s)) return null
  const t = s.replace(/^Merge\s+/i, '').trim()
  return t.length > 3 ? t : null
}

export const fromGit = () => {
  try {
    const out = execFileSync('git', ['log', '--merges', `--since=${DAYS}.days`, '--pretty=format:%h%x09%ct%x09%s'], { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out
      .split('\n')
      .map((line) => line.split('\t'))
      .filter((p) => p.length >= 3)
      .map(([hash, t, subject]) => ({ hash, at: Number(t) * 1000, title: noteTitle(subject) }))
      .filter((n) => n.title)
  } catch {
    return []
  }
}

const readBaseline = () => {
  try {
    const list = JSON.parse(readFileSync(BASELINE, 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

// git's notes plus the baseline's, newest first, one per merge, the last 60 days
export const releaseNotes = (now = Date.now()) => {
  const seen = new Set()
  return [...fromGit(), ...readBaseline()]
    .filter((n) => n && n.hash && !seen.has(n.hash) && seen.add(n.hash))
    .filter((n) => now - n.at <= DAYS * 86400e3)
    .sort((a, b) => b.at - a.at)
    .slice(0, 120)
}

// `node releaseNotes.mjs`: refresh the baseline from git
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const notes = releaseNotes()
  writeFileSync(BASELINE, JSON.stringify(notes, null, 1) + '\n')
  console.log(`release-notes.json: ${notes.length} notes`)
}
