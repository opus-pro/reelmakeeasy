/**
 * Camera style for long-take videos: Calm (the original ReelMakeEasy clip prompt) or Dynamic.
 *
 * Dynamic's rules are ported from an earlier Hailuo 3 transition master prompt, which
 * measured +49% motion over a one-paragraph prompt.
 * Changes: beats carry no labels (a label written from the narration came back painted on
 * screen), rule X5 keeps narration out of the frame, and each clip gets an assigned camera
 * move that differs from the previous clip's.
 *
 * Shared by the clip-prompt writer, the planning prompts' shot pacing and the
 * `reelmakeeasy-camera` Codex skill, so all three say the same thing.
 */

import { RETIME_MAX_SPEED_MULTIPLIER } from '../utils/retime-constants'

export type CameraStyle = 'calm' | 'dynamic'

export const DEFAULT_CAMERA_STYLE: CameraStyle = 'calm'

export function sanitizeCameraStyle(value: unknown): CameraStyle {
  return value === 'dynamic' ? 'dynamic' : 'calm'
}

export const CAMERA_STYLE_OPTIONS: Record<CameraStyle, { description: string; label: string }> = {
  calm: { description: 'Smooth, steady camera and longer shots.', label: 'Calm' },
  dynamic: {
    description: 'Bold camera moves, quicker shots, something moving in every scene.',
    label: 'Dynamic',
  },
}

export const CAMERA_STYLE_INFO =
  'How the camera moves between shots. Calm glides gently and holds longer; Dynamic moves boldly, cuts quicker and keeps every scene in motion.'

/** Named camera moves, one per clip in rotation, so neighbouring clips never repeat. */
export const CAMERA_MOVES: readonly string[] = [
  'a dolly in on a low arc',
  'a crane up',
  'an orbit around the subject',
  'a tracking shot alongside the action',
  'a fast low push-in',
  'a forward drive through the scene',
  'a hard bank and turn',
  'a rake across the frame',
  'a rack focus from foreground to subject',
  'a hard parallax move past foreground objects',
]

export function cameraMoveFor(
  clipIndex: number,
  seed: number,
): { move: string; previousMove?: string } {
  const n = CAMERA_MOVES.length
  const at = (i: number) => CAMERA_MOVES[(((seed + i) % n) + n) % n]
  const index = Math.max(0, Math.floor(clipIndex))
  return index === 0 ? { move: at(0) } : { move: at(index), previousMove: at(index - 1) }
}

/** A stable number from a project id, so each video starts the rotation somewhere else. */
export function cameraSeed(projectId: string): number {
  let hash = 5381
  for (const ch of projectId) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0
  return hash
}

const HAILUO_SECONDS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]

/** The clip length Hailuo 3 is asked for: the first whole second at or above the slot (5-15). */
export function hailuoGenerationSeconds(slotSeconds: number): number {
  return HAILUO_SECONDS.find((s) => s >= slotSeconds) ?? 15
}

function formatTimestamp(seconds: number): string {
  const totalMillis = Math.round(seconds * 1000)
  const minutes = Math.floor(totalMillis / 60_000)
  const rest = totalMillis - minutes * 60_000
  const wholeSeconds = Math.floor(rest / 1000)
  const millis = rest - wholeSeconds * 1000
  return `${minutes}:${String(wholeSeconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

/** A narration change only counts when it leaves at least half a second on each side. */
function normalizeBoundary(duration: number, boundary?: number): number | undefined {
  return boundary !== undefined &&
    Number.isFinite(boundary) &&
    boundary >= 0.5 &&
    duration - boundary >= 0.5
    ? Number(boundary.toFixed(3))
    : undefined
}

function safeDurationOf(durationSeconds: number): number {
  return Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 4
}

/** Two beats (three above 8 s) tiling the clip; a narration change becomes a beat edge. */
export function buildDynamicBeatRanges(
  durationSeconds: number,
  beatBoundarySeconds?: number,
): string[] {
  const duration = safeDurationOf(durationSeconds)
  const beatCount = duration > 8 ? 3 : 2
  const boundary = normalizeBoundary(duration, beatBoundarySeconds)
  const edges: number[] = [0]
  if (boundary === undefined) {
    for (let i = 1; i < beatCount; i++) edges.push(Number(((duration * i) / beatCount).toFixed(3)))
  } else if (beatCount === 2) {
    edges.push(boundary)
  } else {
    // Three beats: the boundary is one edge and the longer side splits in half.
    const after = duration - boundary
    edges.push(
      ...(boundary >= after
        ? [Number((boundary / 2).toFixed(3)), boundary]
        : [boundary, Number((boundary + after / 2).toFixed(3))]),
    )
  }
  edges.push(duration)
  return edges
    .slice(0, -1)
    .map((start, i) => `[${formatTimestamp(start)}-${formatTimestamp(edges[i + 1])}]`)
}

export const DYNAMIC_PROMPT_MAX_CHARS = 2000

export const DYNAMIC_MOVEMENT_RULES = [
  '=== PART 1 -- MOVEMENT. THIS IS WHAT DECIDES WHETHER THE CLIP WORKS ===',
  '',
  'The most common failure is a prompt that is accurate and dead. Hailuo 3 renders the exact energy level you describe: describe a state and it holds a still image, then jumps. Every beat is full of action.',
  '',
  'M1. THREE LAYERS, EVERY BEAT. A beat is not finished until all three are moving.',
  '    - THE CAMERA -- one named move. For example: dollies in on a low arc, cranes up, orbits, tracks, pushes in fast and low, whips, banks hard, drives forward, rakes across, rack focus, hard parallax.',
  '    - THE SUBJECTS -- at least two distinct changes to whatever the shot is actually about, caught mid-motion. Subjects are whatever this project has: people, animals, vehicles, objects, machines, drawn figures, diagrams, type, abstract shapes.',
  '    - THE SURROUNDINGS -- at least one thing moving on its own that is neither the camera nor a main subject. For example, depending entirely on what this scene contains: light travelling across a wall, a figure crossing behind, fabric or hair, steam or dust, weather, water, traffic, foliage, a crowd, machinery, drawn marks in the margin of an illustrated frame.',
  '',
  'M2. SPEED IS YOUR CHOICE. STILLNESS IS NOT. A slow push-in is a real and often beautiful shot; it fails only when nothing else in the frame is alive. Quiet camera, busy scene. Big camera move, simpler action underneath it. What never works is a beat where the camera is gentle AND the subjects are gentle AND the surroundings are gentle at the same time -- that is the beat that comes back as a held frame. Soften one layer and drive another harder. Words like slightly, gently and softly are fine on one layer at a time; they are a warning sign when they are on all three.',
  '',
  "M3. A POSE IS NOT AN ACTION. Verbs that only state where a thing is or how it is arranged -- sits, stands, holds, rests, remains, waits, looks at, is positioned, is seen, appears -- can never be a subject's only verb. Whatever the subject is, it changes across the beat.",
  '    Examples, one per kind of subject, to show the principle rather than to be copied:',
  '    - a person who cannot leave their seat still laughs, throws their head back, snaps their gaze up, rocks forward, their shoulders shaking',
  '    - an object still tips, rocks, spins, swings, topples, is struck or lifted',
  '    - a drawn panel, diagram or interface still swings, tilts, is driven past by the camera, or is overtaken as the frame moves through it',
  '    - an empty room or a landscape still changes through its light, its weather, and whatever crosses it',
  '    If a subject cannot travel through space, everything else about it moves.',
  '',
  'M4. START MID-ACTION. Something is already happening at 0.000. Never open by describing the first image -- it is already on screen.',
  '',
  'M5. DO NOT WIND DOWN INTO THE ENDING. The final beat carries at least as much action as the first, and ideally more. Hailuo 3 reaches the last frame early and then holds on it; a prompt that calms toward the end makes that hold longer and more visible. Keep something moving all the way into the last frame.',
  '',
  'M6. VERB DENSITY IS THE BUDGET. Spend characters on things happening, not on how things look. After every element is named once, every further sentence carries a verb of motion. If the prompt runs long, cut descriptions of appearance. Never cut actions.',
  '',
  '=== PART 2 -- ONE UNBROKEN TAKE ===',
  '',
  'T1. The beats are moments inside a single continuous shot, not separate shots. They exist to place action in time.',
  '',
  'T2. Every beat after the first CONTINUES the movement of the one before it. For example: "the camera keeps driving forward", "still orbiting, it rises", "the push-in carries on past the near edge". A beat that opens by announcing a new framing or a new place is rendered as a cut and breaks the clip in half.',
  '',
  'T3. Never describe how to get between the two images. No device for crossing -- no pan across, no whip to the next scene, no blur resolving into somewhere else. Describe both ends with full energy and let the model find its own way.',
  '',
  '=== PART 3 -- ANYTHING READABLE ===',
  '',
  'X1. NEVER instruct readable content to change, move or animate. For example: "ticks up", "slides upward", "pops into place", "scrolls", "counts up", "pulses", "flickers", "updates", "blurring with speed". Any such phrase makes the model invent states that exist in neither keyframe and letter them with gibberish. Protected: any screen or interface in the shot, and any lettering, numerals or symbols anywhere in frame on any surface -- for example a sign, a label, a headline, a wordmark, a caption baked into the image, handwriting. If a human could read it, it is protected.',
  '',
  'X2. NAME every readable element and QUOTE every string verbatim in single quotes, exactly as it appears in the attached images, casing included. Vagueness is where invention enters.',
  '',
  'X3. Say what a surface CARRIES or READS, never that it is unchanging, steady or held. The camera can move hard and the subjects can act hard while a surface still reads exactly the characters it reads in the keyframe. Still text does not require a still shot.',
  '',
  'X4. Animate only what already exists in the two images. Never introduce a new object, figure, surface or word in order to create motion.',
  '',
  'X5. Never put narration, captions or any words into the frame that are not already visible in the two images.',
  '',
  '=== PART 4 -- WHAT NEVER APPEARS IN THE OUTPUT ===',
  '',
  'N1. NO RULES. Never write "do not", "avoid", "must not", "ensure", "maintain", "keep". A prompt is a description of a shot, not a spec.',
  '',
  'N2. NO STILLNESS VOCABULARY: holds steady, holds still, remains locked, perfectly still, settles into, static, stable, frozen, rests, sits centred, micro-movements, almost imperceptibly.',
  '',
  'N3. NO ROUTE OR EDIT VOCABULARY: transition, bridge, wipes away, dissolves, sweeps across, seamlessly, graphic wipe, cuts to, previous shot, the view slides to, resolves into.',
  '',
  'N4. NO ABSTRACT INTENT: establishing, highlighting, emphasizing, reinforcing, conveying, showcasing. Nothing to render, so the model invents something to satisfy it.',
  '',
  'N5. Use "live-action" for filmed styles. Never "photorealistic" -- that word describes a still photograph and the model renders one.',
  '',
  '=== PART 5 -- STYLE ===',
  '',
  'S1. Preserve the style words from the vibe and the visual script: art style, palette, light, materials, era, linework, texture.',
  "S2. Preserve nothing else of the visual script's phrasing. Style words are content; camera and transition directions are not.",
  "S3. These rules hold for every style and every subject. All three layers of movement exist in live action, in 2D animation, in flat illustration, in 3D, in stop motion, and in a frame with no people in it at all -- only what fills each layer changes. Describe what this project's style actually contains, and never import an element from a style it does not use.",
].join('\n')

export function buildDynamicTransitionRewritePrompt(params: {
  beatBoundarySeconds?: number
  durationSeconds: number
  move: string
  previousMove?: string
  vibe?: null | string
  visualScript: string
}): string {
  const duration = safeDurationOf(params.durationSeconds)
  const boundary = normalizeBoundary(duration, params.beatBoundarySeconds)
  const ranges = buildDynamicBeatRanges(duration, boundary)
  const vibe = params.vibe?.trim() || 'match the visual style of the two keyframes'
  const ordinals = ['first', 'second', 'third']
  const edgeIndex =
    boundary === undefined
      ? -1
      : ranges.findIndex((r) => r.endsWith(`-${formatTimestamp(boundary)}]`))
  const boundaryLine =
    edgeIndex === -1 || edgeIndex + 1 >= ranges.length
      ? ''
      : `- VO beat boundary: the narration beat changes at the edge between the ${ordinals[edgeIndex]} and ${ordinals[edgeIndex + 1]} timecode ranges; the outgoing scene's energy carries to that edge and the incoming scene's main subject lands after it.`
  const moveLine = `Camera move for this clip: ${params.move}. Use it, or another named move if it cannot carry these two frames${
    params.previousMove ? `, but never ${params.previousMove}, which the previous clip used` : ''
  }.`
  return [
    'You are the Hailuo 3 Story Mode Prompt Engineer and Keyframe Interpolation Expert.',
    '',
    'Write one Hailuo 3 (MiniMax-H3) API-ready video prompt from the provided Story Mode visual script. Hailuo 3 does KEYFRAME INTERPOLATION: the FIRST attached image is the exact first frame, the SECOND attached image is the exact final frame, and both already exist. Your prompt describes ONE CONTINUOUS TAKE running from the first to the second, and that take must be full of movement from its first frame to its last.',
    '',
    'Inputs:',
    `- Clip duration: ${duration}s`,
    `- Beat timecode ranges: ${ranges.join(', ')}`,
    `- Vibe: ${vibe}`,
    `- Visual script: ${params.visualScript}`,
    '- FIRST attached image = exact frame zero / source keyframe',
    '- SECOND attached image = exact final frame / destination keyframe',
    '',
    moveLine,
    '',
    'HOW TO READ THE INPUTS',
    'The vibe and the visual script are upstream text written for a different purpose. They are a source of SUBJECT MATTER and STYLE, and of nothing else. You are the only writer in this chain who knows how Hailuo 3 behaves.',
    '',
    'TAKE from them: what is in the shot, what happens in it, the medium and art style, palette, light, materials and era.',
    '',
    'WHERE TO DEPART FROM THEM. Upstream text carries habits that produce a dead render. Where it does any of the following, these rules win:',
    '    - Camera direction that sets the energy of the whole frame. Keep the camera idea if it suits the shot -- a slow push-in is a perfectly good choice. What you must not inherit is its calm applied to everything at once. Upstream text tends to describe every layer as quiet together. Take the camera idea, then give the subjects and the surroundings real action underneath it.',
    '    - Any instruction that readable content changes. For example "the text pulses", "the numbers lock into place", "the interface settles into a stable layout". These never survive into your output in any form. See Part 3.',
    '    - Stillness vocabulary. For example "holding steady", "settles into", "remains", "stable". See Part 4.',
    '    - A device for travelling between the two images. For example a fast pan, a lateral slide, "as if scanning a continuous mural", "THE VIEW SLIDES TO". These are pipeline plumbing, not content. See T3.',
    '    - The word "photorealistic", which vibes very often carry. Write "live-action" instead. See N5.',
    '',
    'Overriding is not optional and it is not a conflict. Where the upstream text and these rules disagree, these rules win, every time. Preserving a phrase from the vibe is never a reason to break a rule below.',
    '',
    DYNAMIC_MOVEMENT_RULES,
    '',
    '=== OUTPUT FORMAT ===',
    '',
    `- Timecoded beats, each "[m:ss.sss-m:ss.sss] text" with no label or title, tiling the full duration with exactly these ranges: ${ranges.join(', ')} -- no gaps.`,
    boundaryLine,
    '- Aim for 900-1200 characters. Action per character is the goal, not length.',
    '',
    'Return only the final Hailuo 3 prompt in the requested timecoded format. No explanation outside the prompt.',
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
}

const TIMECODE = /\[\d+:\d{2}\.\d{3}-\d+:\d{2}\.\d{3}\]/

/** The beats only: no code fences or preamble, at most `maxChars`, cut after a whole beat.
 *  Empty when the answer has no timecodes (the caller then falls back to Calm). */
export function cleanDynamicTransitionPrompt(
  text: string,
  maxChars: number = DYNAMIC_PROMPT_MAX_CHARS,
): string {
  const unfenced = text.replaceAll(/```[a-z]*\n?/gi, '').trim()
  const start = unfenced.search(TIMECODE)
  if (start === -1) return ''
  const body = unfenced
    .slice(start)
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
  if (body.length <= maxChars) return body
  const beatStarts = [...body.matchAll(new RegExp(TIMECODE.source, 'g'))]
    .map((m) => m.index ?? 0)
    .filter((i) => i > 0 && i <= maxChars)
  if (beatStarts.length > 0) return body.slice(0, beatStarts[beatStarts.length - 1]).trim()
  const cut = body.slice(0, maxChars)
  const sentenceEnd = cut.lastIndexOf('. ')
  return (sentenceEnd > 0 ? cut.slice(0, sentenceEnd + 1) : cut).trim()
}

export function preferredShotRhythm(style?: CameraStyle | null): '3-6s' | '5-8s' {
  return style === 'dynamic' ? '3-6s' : '5-8s'
}

/**
 * Hailuo makes clips of 5 s or more and the pipeline retimes them to their slot, speeding up
 * at most this much and trimming the rest. Dynamic plans 3-6 s shots, so its clips may play
 * up to 1.6x faster (5 s fills a 3.1 s slot) instead of losing their endings; quicker motion
 * suits the style. Calm keeps the default cap.
 */
export const DYNAMIC_RETIME_MAX_SPEED_MULTIPLIER = 1.6

export function retimeMaxSpeedFor(style?: CameraStyle | null): number {
  return style === 'dynamic' ? DYNAMIC_RETIME_MAX_SPEED_MULTIPLIER : RETIME_MAX_SPEED_MULTIPLIER
}
