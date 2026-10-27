import { ANIMATION_TASKS } from '@reelmakeeasy/common/motion-reel/motion-tasks'
import type {
  AgentAnimationSetupView,
  AgentMotionTask,
  AgentMotionTaskId,
  AgentSession,
} from '@shared/types/api/agent'

import type { MotionToolCall, ReelFacts } from '../motion-reel/motion-tasks'
import {
  callsOf,
  detailLines,
  failedPhase,
  firstLine,
  MAX_DETAILS,
  type Phase,
  toolCalls,
} from '../motion-reel/task-phases'

/** What an animation's folder and tool calls show, for its Tasks panel. */
export interface AnimationTaskInput {
  calls: MotionToolCall[]
  facts: ReelFacts
  mode: AgentSession['mode']
  setup: AgentAnimationSetupView | undefined
  /** Claude's turn is running. */
  working: boolean
}

/** A Claude Animation's phases, from facts ReelMakeEasy reads (the setup, `animation/` and the
 *  chat's animation tool calls), never from what Claude says. */
export function animationTasks(input: AnimationTaskInput): AgentMotionTask[] {
  const phases: Partial<Record<AgentMotionTaskId, Phase>> = {
    build: buildPhase(input),
    look: lookPhase(input.calls),
    music: musicPhase(input),
    plan: planPhase(input.facts),
    render: renderPhase(input.calls),
    review: reviewPhase(input),
    setup: setupPhase(input),
    voice: voicePhase(input.calls),
  }
  return ANIMATION_TASKS.map(({ id, label }) => ({
    id,
    label,
    ...(phases[id] ?? { result: null, state: 'waiting' as const }),
  }))
}

function setupPhase({ calls, mode, setup }: AnimationTaskInput): Phase {
  const last = callsOf(calls, 'animation_setup').at(-1)
  if (last && last.ok === undefined)
    return { result: 'Setting up the animation…', state: 'running' }
  if (setup) return { result: `${setup.lookLabel}, about ${setup.lengthSec} s`, state: 'done' }
  if (last && !last.ok) return failedPhase(last.text)
  return { result: mode === 'animation' ? 'Waiting for the setup card' : null, state: 'waiting' }
}

function planPhase({ plan }: ReelFacts): Phase {
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

/** The voices: running while animation_voice records; done with its first sentence ("Recorded 6
 *  lines (…): 31 s in all") and the lines to listen to. */
function voicePhase(calls: MotionToolCall[]): Phase {
  const last = callsOf(calls, 'animation_voice').at(-1)
  if (!last) return { result: null, state: 'waiting' }
  if (last.ok === undefined) return { result: 'Recording the voices…', state: 'running' }
  if (!last.ok) return failedPhase(last.text)
  const head = firstLine(last.text).replace(/, saved as .*$/, '')
  const listen = detailLines(last.text).filter((l) => /listen to/i.test(l))
  return { ...(listen.length ? { details: listen } : {}), result: head, state: 'done' }
}

function musicPhase({ calls, facts, setup, working }: AnimationTaskInput): Phase {
  if (!setup) return { result: null, state: 'waiting' }
  const last = callsOf(calls, 'animation_music').at(-1)
  if (last && last.ok === undefined) return { result: 'Putting the music in…', state: 'running' }
  // Claude works on its score in its own shell (writing music.mjs, running the composer).
  if (working && facts.musicChangedAt > (last?.endedAt ?? 0))
    return { result: 'Composing in animation/music/ (the composer)…', state: 'running' }
  if (last && !last.ok) return failedPhase(last.text)
  if (setup.music.source === 'none') return { result: 'No music', state: 'done' }
  if (setup.musicTitle) return { result: setup.musicTitle, state: 'done' }
  return {
    result: facts.musicScore ? 'Score written (music/music.mjs), not in yet' : null,
    state: 'waiting',
  }
}

function buildPhase({ calls, facts, working }: AnimationTaskInput): Phase {
  const { lastChange, names } = facts.scenes
  const last = calls.at(-1)
  if (last?.refused === 'type-check' && lastChange <= last.startedAt)
    return { details: detailLines(last.text), result: "Doesn't type-check", state: 'failed' }
  if (!names.length) return { result: null, state: 'waiting' }
  const lastRender = toolCalls(calls).findLast((c) => c.tool === 'animation_render')?.startedAt ?? 0
  return {
    details: names.slice(0, MAX_DETAILS),
    result: `${names.length} scene file${names.length === 1 ? '' : 's'}`,
    state: working && lastChange > lastRender ? 'running' : 'done',
  }
}

function lookPhase(calls: MotionToolCall[]): Phase {
  const looks = callsOf(calls, 'animation_still')
  const last = looks.at(-1)
  if (!last) return { result: null, state: 'waiting' }
  const done = looks.filter((c) => c.ok)
  const details = stillLines(done.at(-1)?.text).slice(0, MAX_DETAILS)
  const withDetails = details.length ? { details } : {}
  if (last.ok === undefined)
    return { ...withDetails, result: 'Rendering stills…', state: 'running' }
  if (!last.ok) return failedPhase(last.text)
  const stills = done.flatMap((c) => stillLines(c.text)).length
  return {
    ...withDetails,
    result: `${stills} still${stills === 1 ? '' : 's'} over ${done.length} look${done.length === 1 ? '' : 's'}`,
    state: 'done',
  }
}

function renderPhase(calls: MotionToolCall[]): Phase {
  const renders = callsOf(calls, 'animation_render')
  const last = renders.at(-1)
  const made = renders.filter((c) => c.ok).length
  if (!last) return { result: null, state: 'waiting' }
  if (last.ok === undefined) return { result: `Rendering ${made + 1}…`, state: 'running' }
  if (!last.ok) return failedPhase(last.text)
  return { result: made === 1 ? 'Rendered' : `Render ${made}`, state: 'done' }
}

/**
 * The review after a render (`animation_review`): running while it makes its sheets; done with how
 * many and the round, and what `review.md` says; waiting again once a newer render is not reviewed.
 */
function reviewPhase({ calls, facts }: AnimationTaskInput): Phase {
  const renders = callsOf(calls, 'animation_render').filter((c) => c.ok)
  const reviews = callsOf(calls, 'animation_review')
  const last = reviews.at(-1)
  if (!last)
    return renders.length
      ? { result: `Render ${renders.length} not reviewed yet`, state: 'waiting' }
      : { result: null, state: 'waiting' }
  if (last.ok === undefined) return { result: 'Making contact sheets…', state: 'running' }
  const newest = renders.at(-1)
  if (!last.ok && !(newest && newest.startedAt > last.startedAt)) return failedPhase(last.text)
  const checked = reviews.findLast((c) => c.ok)
  if (!checked) return { result: `Render ${renders.length} not reviewed yet`, state: 'waiting' }
  const round = renders.filter((c) => c.startedAt < checked.startedAt).length
  const sheets = Number(/Made (\d+) contact sheet/.exec(checked.text ?? '')?.[1] ?? 0)
  const notes = facts.review
    ? facts.review.problems
      ? `review.md: ${facts.review.problems} problem${facts.review.problems === 1 ? '' : 's'}`
      : facts.review.firstLine && `review.md: ${facts.review.firstLine}`
    : ''
  const result = [`${sheets} sheet${sheets === 1 ? '' : 's'}, round ${Math.max(1, round)}`, notes]
    .filter(Boolean)
    .join(' · ')
  if (newest && newest.startedAt > checked.startedAt)
    return { result: `${result}; render ${renders.length} not reviewed yet`, state: 'waiting' }
  return { result, state: 'done' }
}

/** The still lines of an animation_still answer ("12.5 s"). */
function stillLines(text: string | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((l) => /^- ([\d.]+ s) \(frame/.exec(l)?.[1])
    .filter((l): l is string => !!l)
}
