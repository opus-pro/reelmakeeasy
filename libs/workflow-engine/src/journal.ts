import fs from 'node:fs'
import path from 'node:path'

/**
 * A tiny on-disk record of which workflow runs are open, so that after a
 * restart the app can tell which runs were cut short. Runs themselves are not
 * resumable: only their identity is kept.
 */
export interface JournalEntry {
  runId: string
  startTime: string
  taskQueue: string
  workflowId: string
  workflowType: string
}

let journalPath: string | undefined
const open = new Map<string, JournalEntry>()
let pending: NodeJS.Timeout | undefined

export function setJournalPath(file: string | undefined): void {
  journalPath = file
}

function flush(): void {
  pending = undefined
  if (!journalPath) return
  fs.mkdirSync(path.dirname(journalPath), { recursive: true })
  const tmp = `${journalPath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify([...open.values()]))
  fs.renameSync(tmp, journalPath)
}

function scheduleFlush(): void {
  if (!journalPath || pending) return
  pending = setTimeout(flush, 200)
  pending.unref?.()
}

export function journalOpened(entry: JournalEntry): void {
  open.set(entry.runId, entry)
  scheduleFlush()
}

export function journalClosed(runId: string): void {
  if (open.delete(runId)) scheduleFlush()
}

/**
 * Runs that were open when the process last stopped. Call once at boot, before
 * starting new work; the journal is reset to the current (empty) state.
 */
export function takeInterruptedRuns(): JournalEntry[] {
  if (!journalPath || !fs.existsSync(journalPath)) return []
  let entries: JournalEntry[] = []
  try {
    entries = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as JournalEntry[]
  } catch {
    entries = []
  }
  flush()
  return entries.filter((e) => !open.has(e.runId))
}
