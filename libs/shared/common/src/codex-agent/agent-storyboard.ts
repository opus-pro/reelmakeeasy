import type { AgentLoopLine } from '@shared/types/api/agent'
import type { LongTakeKeyframe, LongTakeTransition } from '@shared/types/api/long-take'

import type { TranscriptEntry } from './agent-transcript'

/**
 * Pure helpers behind the agent page's storyboard panel and video previews. They live
 * here (not in the web app) so they can be unit-tested beside the transcript reducer.
 */

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

/**
 * The video URL with a render version, so a re-render (which republishes the same
 * `final_video.mp4` URL) makes the player load the new file. Version 0 is the URL as is.
 */
export function versionedVideoUrl(url: string, version: number): string {
  if (version <= 0) return url
  const hashIndex = url.indexOf('#')
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  return `${base}${base.includes('?') ? '&' : '?'}v=${version}${hash}`
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

/**
 * The keyframes in shot order. Shot ids come from the planner (e.g. "1", "LT_S2",
 * "3_part_2"), so their names can't be sorted reliably. `keyframes.json` keeps the shot
 * plan's order (the keyframe workflow writes its results indexed by the plan), and that
 * order is kept unless the transitions, by `startMs`, form one complete chain (each
 * transition starts where the previous one ended, no shot twice) covering exactly the
 * keyframes' shots: then the chain's order wins. Partial transitions change nothing.
 */
export function orderKeyframes(
  keyframes: readonly LongTakeKeyframe[],
  transitions: readonly LongTakeTransition[],
): LongTakeKeyframe[] {
  const sorted = [...transitions].sort((a, b) => a.startMs - b.startMs)
  if (sorted.length === 0) return [...keyframes]
  const sequence = [sorted[0].fromShotId]
  for (const [i, t] of sorted.entries()) {
    const chained = i === 0 || sorted[i - 1].toShotId === t.fromShotId
    if (!chained || sequence.includes(t.toShotId)) return [...keyframes]
    sequence.push(t.toShotId)
  }
  const ids = new Set(keyframes.map((k) => k.shotId))
  const complete =
    ids.size === keyframes.length &&
    sequence.length === ids.size &&
    sequence.every((id) => ids.has(id))
  if (!complete) return [...keyframes]
  return [...keyframes].sort((a, b) => sequence.indexOf(a.shotId) - sequence.indexOf(b.shotId))
}

// ---------------------------------------------------------------------------
// Idea and script
// ---------------------------------------------------------------------------

/** `Foo (Recommended)`, any case, with optional spaces around the suffix. */
const RECOMMENDED_RE = /\s*\(\s*recommended\s*\)\s*$/i

/** An option label without its " (Recommended)" suffix, and whether it had one. */
export const splitRecommended = (label: string) =>
  RECOMMENDED_RE.test(label)
    ? { recommended: true, text: label.replace(RECOMMENDED_RE, '') }
    : { recommended: false, text: label }

type QuestionEntry = Extract<TranscriptEntry, { kind: 'question' }>

/** The option picked (or the text typed) on the latest answered card with this `header`: its
 *  label without " (Recommended)" as `title`, its description as `hook`. Null without one. */
function pickedAnswer(
  entries: readonly TranscriptEntry[],
  header: string,
): null | { hook?: string; title: string } {
  const entry = entries.findLast(
    (e): e is QuestionEntry =>
      e.kind === 'question' && e.state === 'answered' && e.questions[0]?.header === header,
  )
  const question = entry?.questions[0]
  const answer = question ? entry.answers?.[question.id]?.[0]?.trim() : undefined
  if (!question || !answer) return null
  const option = (question.options ?? []).find((o) => o.label === answer)
  if (!option) return { title: answer }
  return { hook: option.description || undefined, title: splitRecommended(option.label).text }
}

/** The idea the user picked on the autonomous flow's idea card. */
export function pickedIdea(
  entries: readonly TranscriptEntry[],
): null | { hook?: string; title: string } {
  return pickedAnswer(entries, 'Idea')
}

/** The header of the autonomous flow's card that picks the video's opener. */
export const ATTENTION_HOOK_HEADER = 'Attention hook'

/** The opener the user picked (or wrote) on the autonomous flow's attention-hook card. Chats
 *  made before the card was renamed called it "Opening". */
export function pickedOpening(
  entries: readonly TranscriptEntry[],
): null | { hook?: string; title: string } {
  return pickedAnswer(entries, ATTENTION_HOOK_HEADER) ?? pickedAnswer(entries, 'Opening')
}

/** The header of the autonomous flow's camera style card. */
export const CAMERA_STYLE_HEADER = 'Camera style'

/** The camera style the user picked on the autonomous flow's card. */
export function pickedCameraStyle(
  entries: readonly TranscriptEntry[],
): null | { hook?: string; title: string } {
  return pickedAnswer(entries, CAMERA_STYLE_HEADER)
}

/** The header of the autonomous flow's length card (after the camera card). */
export const LENGTH_HEADER = 'Length'

export const MUSIC_HEADER = 'Music'

/** The music choice the user made on the autonomous flow's card (a preset or their words). */
export function pickedMusic(
  entries: readonly TranscriptEntry[],
): null | { hook?: string; title: string } {
  return pickedAnswer(entries, MUSIC_HEADER)
}

/**
 * The voice-over script as lines: one per line break, and one per sentence (split after
 * `.`, `!`, `?` or an ellipsis character, and any closing quotes or brackets after it,
 * followed by whitespace, so "3.5" stays whole and `'and.'` ends its sentence).
 * No regex lookbehind: Safari before 16.4 can't parse it.
 */
export function scriptLines(script: string): string[] {
  return script
    .replace(/([.!?…]+["'”’)\]]*)\s+/g, '$1\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * A loop short's lines for the Script panel, each with its stamp: the storyboard's
 * (`make_beat_loop`), with the words of each from the project's script once the video has one
 * (one line per clip: a redo may have rewritten a line). A script that hasn't one line per clip
 * (a project from before, or a failed read) leaves the storyboard's lines as they are.
 */
export function loopScriptLines(
  lines: readonly AgentLoopLine[],
  script: null | string,
): AgentLoopLine[] {
  const spoken = (script ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (spoken.length !== lines.length) return [...lines]
  return lines.map((line, i) => ({ ...line, narration: spoken[i] }))
}
