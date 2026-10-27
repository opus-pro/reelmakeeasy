import fs from 'node:fs'
import path from 'node:path'

import { Logger } from '@reelmakeeasy/common/logger'
import { MOTION_MAX_RENDERS, MOTION_TASKS } from '@reelmakeeasy/common/motion-reel/motion-tasks'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  type AgentMotionPlan,
  type AgentMotionSetupView,
  type AgentMotionTask,
  type AgentMotionTaskId,
  type AgentSession,
  isAnimationMode,
  isCodeVideoMode,
} from '@shared/types/api/agent'

import { ANIMATION_DIR } from '../animation/animation-project'
import { animationTasks } from '../animation/animation-tasks'
import type { ToolCallResult } from '../tools/agent-tools'

import { REEL_DIR } from './motion-project'
import {
  callsOf,
  detailLines,
  failedPhase,
  firstLine,
  MAX_DETAILS,
  type Phase,
  toolCalls,
} from './task-phases'

const logger = new Logger('MotionTasks')

/** Where a reel keeps its Motion Reel tool calls (so the phases survive a restart). */
const HISTORY_FILE = path.join('out', 'motion-tasks.json')

/** Calls kept per chat, and the result text kept per call: enough for the phases. */
const MAX_CALLS = 200
const MAX_TEXT = 4000
/** A plan larger than this is only counted as there, not read. */
const MAX_PLAN_BYTES = 256 * 1024
/** The most of a plan the Tasks panel shows (its start, when the file is longer). */
export const MAX_PLAN_TEXT_BYTES = 8 * 1024
/** How often a running turn's phases are read again: the agent's own shell work (writing scenes,
 *  running the composer) moves them between Motion Reel tool calls. */
const LIVE_MS = 2500

/** One Motion Reel tool call: in flight until it has `ok`. */
export interface MotionToolCall {
  endedAt?: number
  ok?: boolean
  /** Refused before it ran because the reel doesn't type-check: about the scenes, not the tool. */
  refused?: 'type-check'
  startedAt: number
  /** The answer the agent got (cut to MAX_TEXT). */
  text?: string
  tool: string
}

/** What the reel's folder shows, read with a few stats. */
export interface MotionTaskInput {
  calls: MotionToolCall[]
  facts: ReelFacts
  mode: AgentSession['mode']
  setup: AgentMotionSetupView | undefined
  /** The agent's turn is running. */
  working: boolean
}

export interface ReelFacts {
  /** The newest change (ms) to the composer's score or its output (`music/music.mjs`,
   *  `music/audio/score.wav`, `music/qc/score-report.json`), 0 when none is there. */
  musicChangedAt: number
  /** `music/music.mjs` exists: the agent wrote a score for the composer. */
  musicScore: boolean
  /** `plan.md`, if written: its section and scene counts. */
  plan: null | { scenes: number; sections: number }
  /** `review.md`, if written: its first line and how many problems it lists (its list items). */
  review?: null | { firstLine: string; problems: number }
  /** The scene files under `src/scenes/`, by name, and the newest change (ms). */
  scenes: { lastChange: number; names: string[] }
}

/** A Motion Reel's phases, from the facts: the setup, the reel's folder and the tool calls. */
export function motionTasks(input: MotionTaskInput): AgentMotionTask[] {
  const phases: Partial<Record<AgentMotionTaskId, Phase>> = {
    build: buildPhase(input),
    look: lookPhase(input.calls),
    music: musicPhase(input),
    plan: planPhase(input.facts),
    render: renderPhase(input.calls),
    review: reviewPhase(input),
    setup: setupPhase(input),
    sync: syncPhase(input.calls),
  }
  return MOTION_TASKS.map(({ id, label }) => ({ id, label, ...(phases[id] as Phase) }))
}

/** Reads what the reel's folder (`projectDir`) shows; anything missing reads as not there. */
export function readReelFacts(projectDir: string): ReelFacts {
  const music = path.join(projectDir, 'music')
  return {
    musicChangedAt: Math.max(
      ...['music.mjs', 'audio/score.wav', 'qc/score-report.json'].map((f) =>
        mtimeOf(path.join(music, f)),
      ),
    ),
    musicScore: fs.existsSync(path.join(projectDir, 'music', 'music.mjs')),
    plan: readPlan(path.join(projectDir, 'plan.md')),
    review: readReview(path.join(projectDir, 'review.md')),
    scenes: readScenes(path.join(projectDir, 'src', 'scenes')),
  }
}

/**
 * `plan.md` in the reel's folder (`projectDir`) as the Tasks panel shows it: its first
 * MAX_PLAN_TEXT_BYTES as plain text, and when it last changed. The agent writes it, so it is only
 * ever shown as text; null when it is missing, not a plain file (a link is not followed) or can't
 * be read.
 */
export function readPlanText(projectDir: string): AgentMotionPlan | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(
      path.join(projectDir, 'plan.md'),
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    )
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) return null
    const buffer = Buffer.alloc(Math.min(stat.size, MAX_PLAN_TEXT_BYTES))
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0)
    const truncated = stat.size > read
    const text = buffer.subarray(0, read).toString('utf8')
    // Cut at the cap, the last character may be cut in two.
    return {
      changedAt: stat.mtimeMs,
      text: truncated ? text.replace(/\uFFFD+$/, '') : text,
      truncated,
    }
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** What the tracker needs from the session service. */
export interface MotionTaskSessions {
  emitAutonomousEvent(
    id: string,
    event: { plan?: AgentMotionPlan | null; tasks: AgentMotionTask[]; type: 'motion_tasks' },
  ): void
  getSession(id: string): AgentSession
  workingDir(id: string): string
}

/**
 * Keeps each Motion Reel chat's tool calls and sends its phases (`motion_tasks`) when a Motion
 * Reel tool call starts and ends, every few seconds while the agent's turn runs (its own shell
 * work moves them too), when the agent asks the user something and when the turn ends or the
 * agent stops; the same list twice is sent once. The plan (`plan.md`) goes with the list when it
 * changed. A call refused because another is running is not kept.
 */
export class MotionTaskTracker {
  private readonly calls = new Map<string, MotionToolCall[]>()
  private readonly live = new Map<string, ReturnType<typeof setInterval>>()
  /** What was last sent per chat: the list, and the plan (null: none). */
  private readonly sent = new Map<string, { plan: null | string; tasks: string }>()

  constructor(private readonly sessions: MotionTaskSessions) {}

  /** The agent is asking the user something (its question card): what it wrote so far, its plan
   *  above all, shows before the card. */
  questionAsked(id: string): void {
    this.send(id)
  }

  /** Runs a Motion Reel tool call (`run`), sending the phases as it starts and ends. */
  async track(
    id: string,
    tool: string,
    run: () => Promise<ToolCallResult>,
  ): Promise<ToolCallResult> {
    const calls = this.history(id)
    if (calls.some((c) => c.ok === undefined)) return run()
    const call: MotionToolCall = { startedAt: Date.now(), tool }
    calls.push(call)
    if (calls.length > MAX_CALLS) calls.splice(0, calls.length - MAX_CALLS)
    this.send(id)
    let result: ToolCallResult | undefined
    try {
      result = await run()
      return result
    } finally {
      call.endedAt = Date.now()
      call.ok = result?.success ?? false
      call.text = (result?.text ?? 'The call failed.').slice(0, MAX_TEXT)
      if (result?.refused === 'type-check') call.refused = 'type-check'
      // Refused because another call or the setup is running: it did nothing to show.
      if (result?.refused === 'busy') calls.splice(calls.indexOf(call), 1)
      this.save(id, calls)
      this.send(id)
    }
  }

  /** The agent's turn ended, or it stopped: its scenes and plan may have changed. */
  turnEnded(id: string): void {
    const timer = this.live.get(id)
    if (timer) clearInterval(timer)
    this.live.delete(id)
    this.send(id)
  }

  /** The agent's turn started: its phases are read again every few seconds until it ends. */
  turnStarted(id: string): void {
    try {
      if (this.live.has(id) || !isCodeVideoMode(this.sessions.getSession(id).mode)) return
    } catch {
      return
    }
    const timer = setInterval(() => {
      let running = false
      try {
        running = this.sessions.getSession(id).status === 'running'
      } catch {
        // The chat is gone.
      }
      if (running) this.send(id)
      else this.turnEnded(id)
    }, LIVE_MS)
    timer.unref()
    this.live.set(id, timer)
    this.send(id)
  }

  /** The chat's calls: in memory, else from the reel's folder. */
  private history(id: string): MotionToolCall[] {
    let calls = this.calls.get(id)
    if (!calls) {
      calls = loadCalls(this.historyFile(id))
      this.calls.set(id, calls)
    }
    return calls
  }

  private historyFile(id: string): string {
    return path.join(this.projectDir(id), HISTORY_FILE)
  }

  /** The chat's project folder: a Motion Reel's `reel/`, a Claude Animation's `animation/`. */
  private projectDir(id: string): string {
    const animation = isAnimationMode(this.sessions.getSession(id).mode)
    return path.join(this.sessions.workingDir(id), animation ? ANIMATION_DIR : REEL_DIR)
  }

  private save(id: string, calls: MotionToolCall[]): void {
    const file = this.historyFile(id)
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(calls.filter((c) => c.ok !== undefined)))
    } catch (error) {
      logger.warn(`Motion tasks for ${id} not saved: ${ensureError(error).message}`)
    }
  }

  private send(id: string): void {
    try {
      const session = this.sessions.getSession(id)
      if (!isCodeVideoMode(session.mode)) return
      const reel = this.projectDir(id)
      const input = {
        calls: this.history(id),
        facts: readReelFacts(reel),
        mode: session.mode,
        working: session.status === 'running',
      }
      const tasks = isAnimationMode(session.mode)
        ? animationTasks({ ...input, setup: session.animation })
        : motionTasks({ ...input, setup: session.motionReel })
      const plan = readPlanText(reel)
      const now = {
        plan: plan && `${plan.changedAt}\n${plan.text}`,
        tasks: JSON.stringify(tasks),
      }
      const last = this.sent.get(id)
      if (last?.tasks === now.tasks && last.plan === now.plan) return
      this.sent.set(id, now)
      // The plan only when it changed (the first list after a restart always has it).
      this.sessions.emitAutonomousEvent(
        id,
        last && last.plan === now.plan
          ? { tasks, type: 'motion_tasks' }
          : { plan, tasks, type: 'motion_tasks' },
      )
    } catch (error) {
      // The phases are only shown: a chat that is gone, or a folder that can't be read, costs
      // nothing but the update.
      logger.warn(`Motion tasks for ${id} not sent: ${ensureError(error).message}`)
    }
  }
}

function buildPhase({ calls, facts, working }: MotionTaskInput): Phase {
  const { lastChange, names } = facts.scenes
  // The last call was refused because the scenes don't type-check, and none changed since.
  const last = calls.at(-1)
  if (last?.refused === 'type-check' && lastChange <= last.startedAt)
    return { details: detailLines(last.text), result: "Doesn't type-check", state: 'failed' }
  if (!names.length) return { result: null, state: 'waiting' }
  const lastRender = toolCalls(calls).findLast((c) => c.tool === 'motion_render')?.startedAt ?? 0
  const result = `${names.length} scene file${names.length === 1 ? '' : 's'}`
  const details = names.slice(0, MAX_DETAILS)
  // Scenes changed since the last render, while the agent works: it is building them now.
  const state = working && lastChange > lastRender ? 'running' : 'done'
  return { details, result, state }
}

function loadCalls(file: string): MotionToolCall[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (c): c is MotionToolCall =>
          !!c &&
          typeof c === 'object' &&
          typeof (c as MotionToolCall).tool === 'string' &&
          typeof (c as MotionToolCall).startedAt === 'number' &&
          typeof (c as MotionToolCall).ok === 'boolean',
      )
      .slice(-MAX_CALLS)
  } catch {
    return []
  }
}

function lookPhase(calls: MotionToolCall[]): Phase {
  const looks = callsOf(calls, 'motion_still')
  const last = looks.at(-1)
  const done = looks.filter((c) => c.ok)
  const stills = done.flatMap((c) => stillLines(c.text))
  const summary = done.length
    ? `${stills.length} still${stills.length === 1 ? '' : 's'} over ${done.length} look${done.length === 1 ? '' : 's'}`
    : null
  const details = stillLines(done.at(-1)?.text).slice(0, MAX_DETAILS)
  const withDetails = details.length ? { details } : {}
  if (!last) return { result: null, state: 'waiting' }
  if (last.ok === undefined)
    return { ...withDetails, result: 'Rendering stills…', state: 'running' }
  if (!last.ok) return failedPhase(last.text)
  return { ...withDetails, result: summary, state: 'done' }
}

function mtimeOf(file: string): number {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function musicPhase({ calls, facts, setup, working }: MotionTaskInput): Phase {
  if (!setup) return { result: null, state: 'waiting' }
  const { music } = setup
  const last = callsOf(calls, 'motion_music').at(-1)
  if (last?.ok === undefined && last) return { result: 'Composing…', state: 'running' }
  // The agent works on its score in its own shell (writing music.mjs, running the composer).
  if (working && facts.musicChangedAt > (last?.endedAt ?? 0))
    return { result: 'Composing in reel/music/ (the composer)…', state: 'running' }
  if (last && !last.ok) return failedPhase(last.text)
  if (music.source === 'none') return { result: 'No music', state: 'done' }
  if (music.source !== 'agent') return { result: withBpm(setup), state: 'done' }
  if (setup.musicTitle) return { result: withBpm(setup), state: 'done' }
  return {
    result: facts.musicScore ? 'Score written (music/music.mjs), not in the reel yet' : null,
    state: 'waiting',
  }
}

function planPhase(facts: ReelFacts): Phase {
  const { plan } = facts
  if (!plan) return { result: null, state: 'waiting' }
  const parts = [
    plan.sections ? `${plan.sections} section${plan.sections === 1 ? '' : 's'}` : '',
    plan.scenes ? `${plan.scenes} scene${plan.scenes === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return {
    result: parts.length ? `plan.md: ${parts.join(', ')}` : 'plan.md written',
    state: 'done',
  }
}

function readPlan(file: string): ReelFacts['plan'] {
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  if (stat.size > MAX_PLAN_BYTES) return { scenes: 0, sections: 0 }
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const headings = lines.filter((l) => /^#{2,4}\s/.test(l))
  // A scene is a heading or a list item that starts with "Scene".
  const scenes = lines.filter((l) => /^(?:#{2,4}|\s*(?:[-*]|\d+\.))\s+\**scene\b/i.test(l)).length
  return { scenes, sections: headings.filter((l) => !/^#{2,4}\s+\**scene\b/i.test(l)).length }
}

function readReview(file: string): ReelFacts['review'] {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(file)
  } catch {
    return null
  }
  // The agent writes it: a plain file only (a link is not followed), and only so much of it.
  if (!stat.isFile()) return null
  if (stat.size > MAX_PLAN_BYTES) return { firstLine: 'review.md written', problems: 0 }
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const first = lines.map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? ''
  const problems = lines.filter((l) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(l)).length
  return { firstLine: first.length > 120 ? `${first.slice(0, 119)}…` : first, problems }
}

function readScenes(dir: string): ReelFacts['scenes'] {
  let names: string[]
  try {
    names = fs.readdirSync(dir).filter((n) => /\.(?:jsx?|tsx?)$/.test(n))
  } catch {
    return { lastChange: 0, names: [] }
  }
  let lastChange = 0
  for (const name of names) {
    try {
      lastChange = Math.max(lastChange, fs.statSync(path.join(dir, name)).mtimeMs)
    } catch {
      // Gone between the listing and the stat.
    }
  }
  return { lastChange, names: names.sort() }
}

function renderPhase(calls: MotionToolCall[]): Phase {
  const renders = callsOf(calls, 'motion_render')
  const last = renders.at(-1)
  const made = renders.filter((c) => c.ok).length
  const of = (n: number) => (n <= MOTION_MAX_RENDERS ? `${n} of ${MOTION_MAX_RENDERS}` : `${n}`)
  if (!last) return { result: null, state: 'waiting' }
  if (last.ok === undefined) return { result: `Rendering ${of(made + 1)}…`, state: 'running' }
  if (!last.ok) return failedPhase(last.text)
  return { result: `Render ${of(made)}`, state: 'done' }
}

/**
 * The review after a render (`motion_review`): running while it makes its sheets; done with how
 * many and the round (the renders reviewed so far), and what `review.md` says (its problem count,
 * else its first line); waiting again once a newer render has not been reviewed (a failed review
 * included: the render after it is what waits).
 */
function reviewPhase({ calls, facts }: MotionTaskInput): Phase {
  const reviews = callsOf(calls, 'motion_review')
  const last = reviews.at(-1)
  if (!last) return { result: null, state: 'waiting' }
  const renders = callsOf(calls, 'motion_render').filter((c) => c.ok)
  const round = renders.filter((c) => c.startedAt < last.startedAt).length
  if (last.ok === undefined) return { result: 'Making contact sheets…', state: 'running' }
  const newest = renders.at(-1)
  // A failed review is stale once a newer render is out: that render waits for its review.
  const staleFail = !last.ok && !!newest && newest.startedAt > last.startedAt
  if (!last.ok && !staleFail) return failedPhase(last.text)
  const reviewed = reviews.findLast((c) => c.ok)
  if (!reviewed) return { result: `Render ${renders.length} not reviewed yet`, state: 'waiting' }
  const sheets = Number(/Made (\d+) contact sheet/.exec(reviewed.text ?? '')?.[1] ?? 0)
  const notes = facts.review
    ? facts.review.problems
      ? `review.md: ${facts.review.problems} problem${facts.review.problems === 1 ? '' : 's'}`
      : facts.review.firstLine && `review.md: ${facts.review.firstLine}`
    : ''
  const result = [`${sheets} sheet${sheets === 1 ? '' : 's'}, round ${Math.max(1, round)}`, notes]
    .filter(Boolean)
    .join(' · ')
  const details = paceLines(reviewed.text)
  const withDetails = details.length ? { details } : {}
  if (newest && newest.startedAt > reviewed.startedAt)
    return {
      ...withDetails,
      result: `${result}; render ${renders.length} not reviewed yet`,
      state: 'waiting',
    }
  return { ...withDetails, result, state: 'done' }
}

/** The pace report's lines in a motion_review answer, without the per-shot list. */
function paceLines(text: string | undefined): string[] {
  const after = (text ?? '').split(/Pace report[^\n]*:\n/)[1]
  if (!after) return []
  return (after.split('\n\n')[0] ?? '')
    .split('\n')
    .filter((l) => l && !l.startsWith('- ') && !l.startsWith('Shots ('))
    .slice(0, MAX_DETAILS)
    .map((l) => (l.length > 200 ? `${l.slice(0, 199)}…` : l))
}

function setupPhase({ calls, mode, setup }: MotionTaskInput): Phase {
  const last = callsOf(calls, 'motion_setup').at(-1)
  if (last && last.ok === undefined) return { result: 'Setting up the reel…', state: 'running' }
  if (setup)
    return {
      result: `${setup.typeLabel}, ${setup.ratio}, ${setup.reelSec} s (${setup.bars} bars at ${setup.bpm} BPM)`,
      state: 'done',
    }
  if (last && !last.ok) return failedPhase(last.text)
  return { result: mode === 'motion' ? 'Waiting for the setup card' : null, state: 'waiting' }
}

/** The still lines of a motion_still answer ("beat 4 (frame 120)"). */
function stillLines(text: string | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((l) => /^- (beat [^:]+):/.exec(l)?.[1])
    .filter((l): l is string => !!l)
}

/** The sync report's lines in a motion_render answer, ending with its verdict ("Sync: passes."). */
function syncLines(text: string | undefined): string[] {
  const after = (text ?? '').split(/Sync check[^\n]*:\n/)[1]
  if (!after) return []
  return after.split('\n\n')[0]?.split('\n').filter(Boolean) ?? []
}

function syncPhase(calls: MotionToolCall[]): Phase {
  const renders = callsOf(calls, 'motion_render')
  const last = renders.at(-1)
  if (last && last.ok === undefined)
    return { result: 'Checking after the render…', state: 'running' }
  const checked = renders.findLast((c) => c.ok)
  if (!checked) return { result: null, state: 'waiting' }
  const lines = syncLines(checked.text)
  const verdict = lines.findLast((l) => l.startsWith('Sync:'))
  if (!verdict) return { result: 'No sync report', state: 'done' }
  const details = lines.slice(0, MAX_DETAILS)
  if (verdict.startsWith('Sync: passes')) return { details, result: 'Sync: passes', state: 'done' }
  // "Sync: 3 to fix: section starts, kick pulse." reads as "3 to fix: section starts, kick pulse"
  return { details, result: verdict.replace(/^Sync:\s*/, '').replace(/\.$/, ''), state: 'failed' }
}

/** The music's title with the reel's tempo, unless the title says it already. */
function withBpm(setup: AgentMotionSetupView): string {
  const title = setup.musicTitle ?? 'Your track'
  return /\bBPM\b/.test(title) ? title : `${title}, ${setup.bpm} BPM`
}
