/**
 * Loop shorts ("beat loops"): the storyboard the beat-loop skill writes (its section 10), the
 * checks the server holds it to, the clip prompt in each model's dialect, the keyframe prompt
 * and the cost.
 *
 * A loop short is N clips of 4 s. Each clip plays one bar: two beats of HIT (0-2 s), one of
 * FREEZE (2-3 s) and one fast camera CUT (3-4 s) into the next keyframe. The last clip lands on
 * the first keyframe, so the video replays seamlessly. The skill is the only source of the
 * writing rules; this module is what the tool, the workflow and the "Make it?" card share.
 *
 * Node only: the cost and the dialect read the model registry.
 */
import {
  beatLoopVideoKeys,
  currentGenerationProvider,
  type GenerationProvider,
  modelRegistry,
  type ModelRegistryFile,
  resolveModel,
  type VideoCaps,
} from '@reelmakeeasy/llm/registry'
import type {
  BeatLoopClip,
  BeatLoopCutCamera,
  BeatLoopHitCamera,
  BeatLoopLength,
  BeatLoopStoryboard,
} from '@shared/types/api/agent'
import { z } from 'zod'

import { stripDeliveryMarkup } from '../tts/delivery-markup'

import {
  BEAT_CLIP_SECONDS,
  BEAT_LINE_OFFSET_SECONDS,
  BEAT_SPEECH_END_SECONDS,
} from './beat-loop-timing'

export {
  BEAT_CLIP_SECONDS,
  BEAT_HOLD_SECONDS,
  BEAT_LINE_OFFSET_SECONDS,
  BEAT_SPEECH_END_SECONDS,
  BEAT_STAMP_WINDOW,
} from './beat-loop-timing'

/** Video lengths a loop can have, in seconds. */
export const BEAT_LOOP_LENGTHS: readonly BeatLoopLength[] = [16, 20, 24, 28, 32]
/** The most a long line may be sped up before the run fails and names the line. */
export const BEAT_MAX_SPEEDUP = 1.3
/** The speech a line may hold: from 0.15 s to 3.6 s of its clip. */
export const BEAT_LINE_SECONDS = BEAT_SPEECH_END_SECONDS - BEAT_LINE_OFFSET_SECONDS

export const HIT_CAMERAS = [
  'Push in',
  'Shake',
  'Zoom in',
] as const satisfies readonly BeatLoopHitCamera[]
export const CUT_CAMERAS = [
  'Push in',
  'Zoom in',
  'Pull out',
  'Tilt up',
  'Tilt down',
  'Pan left',
  'Pan right',
] as const satisfies readonly BeatLoopCutCamera[]

/** Narration words per clip: the hard limits, and the range that fits 0.15-3.6 s best. */
export const NARRATION_WORDS = { bestMax: 10, bestMin: 8, max: 12, min: 6 } as const
export const STAMP_MAX_CHARS = 16

export const NO_TEXT_LINE = 'No text, no labels, no numbers anywhere in this frame.'
export const KEYFRAME_STYLE_REFERENCE_PREFIX =
  'Use the provided image only as the reference for visual style, color grade, lens and lighting; create this new shot: '

/** The skill's "Explainer collage" preset (the look only; never a publisher's name or logo). */
export const EXPLAINER_COLLAGE_STYLE =
  'Editorial explainer collage: textured off-white newsprint paper background, black-and-white halftone archival photo cutouts with thin white sticker borders and soft drop shadows, bold yellow highlighter strokes, hand-drawn red marker circles and arrows, torn paper edges, subtle film grain, flat top-down lighting, vertical 9:16 composition, clean modern graphic design.'

/** The skill's style presets that worked, with the hits and cuts that suit each. */
export const BEAT_LOOP_STYLE_PRESETS: readonly {
  cuts: string
  hits: string
  name: string
  style: string
}[] = [
  {
    cuts: 'zoom into a cutout, pull out to a timeline, whip-pan along a paper strip',
    hits: 'cutouts slam or slide in, marker circles scribble, highlighter swipes, paper crumbles',
    name: 'Explainer collage',
    style: EXPLAINER_COLLAGE_STYLE,
  },
  {
    cuts: 'dive into or out of clouds, whip back through a window',
    hits: 'eruptions, strikes, impacts with Shake',
    name: 'Cinematic nature',
    style:
      'Photoreal cinematic nature documentary, dramatic storm lighting, deep blue-violet shadows with electric white-violet highlights, anamorphic lens, shallow depth of field, vertical 9:16 composition, rich contrast, film grain.',
  },
  {
    cuts: 'crash-zoom into the cup, whip-pan to the machine, drop down through the grinder',
    hits: 'slam, burst, pour, shatter',
    name: 'Macro product',
    style:
      'Photoreal macro product cinematography, warm morning window light, dark walnut and brushed chrome, rich browns with golden highlights, shallow depth of field, vertical 9:16 composition, crisp commercial look.',
  },
]

/**
 * The skill's clip template (section 4), verbatim: every phrase is there because removing it
 * caused a measured failure. H3 reads bracketed camera commands and absolute timecodes.
 * `non_diegetic_music: N/A` must stay the last line: it took music beds from 5 in 6 clips to 0.
 */
export const BEAT_CLIP_TEMPLATE_H3 = `A 4-second vertical short-form clip filmed as ONE continuous shot with no edits. Rhythm 1-2-3-4: two beats of explosive action, one beat of frozen stillness, one beat of fast transition.
0.0s-2.0s [{HIT_CAMERA}]: {HIT} The action starts instantly on the first frame with no build-up: big, sudden, fast motion that fills the frame, motion blur, high energy.
2.0s-3.0s, same shot, same camera angle, no cut, nothing new appears: the motion freezes. {FREEZE} The camera stops dead where the action left it; a held breath in slow motion.
3.0s-4.0s [{CUT_CAMERA}]: {CUT} A sharp, fast camera move with heavy motion blur that arrives on the final frame at 4.0s.
Rules: exactly one change of scene, and only in the last second, through the fast camera move. Stay in the opening scene until 3.0s. Never dissolve, crossfade or morph between the two scenes. No on-screen text, letters, numbers, labels, captions, logos or watermarks anywhere, at any moment.

Style: {STYLE}

Audio: diegetic sound effects only, with a hard impact on the hit and a whoosh on the cut. No music, no narration, no voice-over, no speech, no singing.

non_diegetic_music: N/A`

/**
 * The same template in Gemini Omni's dialect (the one that tested best: every clip kept the beat, 4.000 s).
 * Omni needs the Sources tag naming its two images, "ONE single continuous shot, no scene cuts"
 * (it defaults to several shots), [0-2s]-style timecodes, camera moves written in words and a
 * Sound design line. The music line stays last.
 */
export const BEAT_CLIP_TEMPLATE_OMNI = `[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2]
A 4-second vertical short-form clip filmed as ONE single continuous shot, no scene cuts, no edits. Rhythm 1-2-3-4: two beats of explosive action, one beat of frozen stillness, one beat of fast transition.
[0-2s] {HIT_CAMERA}: {HIT} The action starts instantly on the first frame with no build-up: big, sudden, fast motion that fills the frame, motion blur, high energy.
[2-3s] Same shot, same camera angle, no cut, nothing new appears: the motion freezes. {FREEZE} The camera stops dead where the action left it; a held breath in slow motion.
[3-4s] {CUT_CAMERA}: {CUT} A sharp, fast camera move with heavy motion blur that arrives on the final frame at 4s.
Rules: exactly one change of scene, and only in the last second, through the fast camera move. Stay in the opening scene until 3s. Never dissolve, crossfade or morph between the two scenes. No on-screen text, letters, numbers, labels, captions, logos or watermarks anywhere, at any moment.

Style: {STYLE}

Sound design: diegetic sound effects only: a hard impact at 0s on the hit, near-silence during the freeze, a fast whoosh from 3s to 4s. No music, no dialogue, no narration, no voice-over, no singing.

non_diegetic_music: N/A`

/** Omni's camera moves, written out in words as in the dialect that tested best. */
const OMNI_CAMERA_WORDS: Record<BeatLoopCutCamera | BeatLoopHitCamera, string> = {
  'Pan left': 'The camera whip-pans left',
  'Pan right': 'The camera whip-pans right',
  'Pull out': 'The camera pulls out fast',
  'Push in': 'The camera punches in',
  Shake: 'The camera shakes hard',
  'Tilt down': 'The camera tilts down fast',
  'Tilt up': 'The camera tilts up fast',
  'Zoom in': 'The camera zooms in fast',
}

/** h3: MiniMax Hailuo 3 on fal (the skill's own model). omni: Gemini Omni Flash. */
export type BeatClipDialect = 'h3' | 'omni'

export type BeatClipSlots = Pick<
  BeatLoopClip,
  'cut' | 'cut_camera' | 'freeze' | 'hit' | 'hit_camera'
>

export interface BeatLoopCost {
  clipCount: number
  /** One 4 s clip: a re-roll, or each following clip when one is redone. */
  clipUsd: number
  keyframesUsd: number
  /** The registry key of the clip model priced. */
  model: string
  resolution: string
  totalUsd: number
  /** The clip model's rate at the loop resolution, unrounded (a take's spend is 4 s of it). */
  usdPerSecond: number
  videoUsd: number
}

export type BeatLoopCostInput = {
  /** A video model key or id; default: the `video.firstLast` model of the current provider. */
  model?: string
} & ({ clips: number } | { durationSeconds: number })

export type BeatLoopValidation =
  | { issues: []; ok: true; storyboard: BeatLoopStoryboard; warnings: string[] }
  | { issues: string[]; ok: false; warnings: string[] }

interface FieldIssue {
  message: string
  path: (number | string)[]
}

interface LooseFields {
  clips?: unknown
  duration_s?: unknown
  id?: unknown
  keyframes?: unknown
  narration?: unknown
  prompt?: unknown
  same_as?: unknown
}

/** What a loop costs: each clip billed on the 4 s asked for (H3 bills requested seconds, not
 *  the 4.46 s it returns) at the registry's rate, plus one keyframe picture per clip (the
 *  closing frame is a copy). Voice and caption timing cost cents at most and are left out. */
export function beatLoopCost(input: BeatLoopCostInput): BeatLoopCost {
  const clipCount =
    'clips' in input ? input.clips : Math.round(input.durationSeconds / BEAT_CLIP_SECONDS)
  const resolved = loopModel(input.model)
  const caps = resolved.capabilities
  const resolution = loopResolution(caps)
  const rates = Object.values(caps?.usdPerSecond ?? {})
  const usdPerSecond = caps?.usdPerSecond?.[resolution] ?? (rates.length ? Math.min(...rates) : 0)
  const keyframeUsd = (KEYFRAME_USD as Record<string, number | undefined>)[resolved.provider] ?? 0
  const video = clipCount * BEAT_CLIP_SECONDS * usdPerSecond
  const keyframes = clipCount * keyframeUsd
  return {
    clipCount,
    clipUsd: cents(BEAT_CLIP_SECONDS * usdPerSecond),
    keyframesUsd: cents(keyframes),
    model: resolved.key,
    resolution,
    totalUsd: cents(video + keyframes),
    usdPerSecond,
    videoUsd: cents(video),
  }
}

/** The whole loop's estimate in dollars: what `make_beat_loop` returns and the card shows. */
export function beatLoopCostUsd(input: BeatLoopCostInput): number {
  return beatLoopCost(input).totalUsd
}

/** The prompt dialect for the clip model (default: the `video.firstLast` model). */
export function beatLoopDialect(model?: string): BeatClipDialect {
  return loopModel(model).capabilities?.family === 'omni' ? 'omni' : 'h3'
}

/** The resolution loop clips are made at: the model's native mid size (768p on H3: at 1080p
 *  its anchors drift and chaining breaks), else 720p (Omni). */
export function beatLoopResolution(model?: string): string {
  return loopResolution(loopModel(model).capabilities)
}

/** A loop clip model, in the order a run tries them (`beatLoopModelOrder`). */
export interface BeatLoopModel {
  /** Registry key of the clip model. */
  key: string
  provider: GenerationProvider
}

const KEY_VARS: Record<GenerationProvider, string> = { fal: 'FAL_KEY', google: 'GEMINI_API_KEY' }

/**
 * The loop clip models every take tries, in order, from the `beatLoop.video` list of the
 * models file: the model of the provider chosen in Setup ("who makes the videos": fal makes
 * loops with MiniMax Hailuo 3, Google with Gemini Omni Flash), then the other provider's, only
 * when its key is set, for a take whose first video call failed. Each take starts again with
 * Setup's, so a fallback never sticks to the clips after it. Veo never makes loop clips: fal's
 * Veo 3.1 Fast missed the 1-2-3-4 beat on every test clip, and Veo on the Gemini API takes a
 * last frame only on 8 s clips. The first model is the one every price shown before a run (the
 * tool's reply, the "Make it?" card, a redo's note) is quoted on; the card names the second.
 */
export function beatLoopModelOrder(
  options: {
    chosen?: GenerationProvider
    env?: NodeJS.ProcessEnv
    registry?: Pick<ModelRegistryFile, 'beatLoop' | 'models'>
  } = {},
): BeatLoopModel[] {
  const chosen = options.chosen ?? currentGenerationProvider()
  const env = options.env ?? process.env
  const registry = options.registry ?? modelRegistry()
  const candidates = beatLoopVideoKeys(
    registry,
    (provider) => provider === chosen || Boolean(env[KEY_VARS[provider]]?.trim()),
  )
    .filter((key) => !isVeo(registry.models[key]))
    .map((key) => ({ key, provider: registry.models[key]?.provider as GenerationProvider }))
  const rank = (model: BeatLoopModel): number => (model.provider === chosen ? 0 : 1)
  return candidates
    .map((model, index) => ({ index, model }))
    .sort((a, b) => rank(a.model) - rank(b.model) || a.index - b.index)
    .map(({ model }) => model)
}

/** The STYLE text a dialect gets. On Omni, "newsprint" made it paint newspaper pages and
 *  lettered scraps (all 5 text failures in 18 test clips), so the paper is blank there. */
export function beatLoopStyle(style: string, dialect: BeatClipDialect): string {
  if (dialect !== 'omni') return style
  return style
    .replaceAll(
      /\boff-white newsprint paper background\b/gi,
      'blank off-white paper with no printed text',
    )
    .replaceAll(/\bnewsprint\b/gi, 'blank paper')
}

/** One clip's prompt: the dialect's template with the slots filled. Slots become single
 *  sentences, so nothing a writer puts in them can push the music line off the end. */
export function buildBeatClipPrompt(
  clip: BeatClipSlots,
  style: string,
  dialect: BeatClipDialect = 'h3',
): string {
  const look = oneLine(beatLoopStyle(style, dialect))
  if (!look) throw new Error('A loop clip prompt needs a style')
  const camera = (name: string): string =>
    dialect === 'omni'
      ? ((OMNI_CAMERA_WORDS as Record<string, string | undefined>)[name] ??
        `The camera moves fast (${oneLine(name)})`)
      : oneLine(name)
  const slots: Record<string, string> = {
    CUT: sentence(clip.cut),
    CUT_CAMERA: camera(clip.cut_camera),
    FREEZE: sentence(clip.freeze),
    HIT: sentence(clip.hit),
    HIT_CAMERA: camera(clip.hit_camera),
    STYLE: look,
  }
  const template = dialect === 'omni' ? BEAT_CLIP_TEMPLATE_OMNI : BEAT_CLIP_TEMPLATE_H3
  return template.replaceAll(
    /\{(CUT_CAMERA|CUT|FREEZE|HIT_CAMERA|HIT|STYLE)\}/g,
    (_, key: string) => slots[key] ?? '',
  )
}

/**
 * A keyframe's picture prompt: the storyboard prompt, the no-text line, then the STYLE. Every
 * frame after f0 is an edit of the previous frame, which is only a style reference.
 */
export function buildBeatKeyframePrompt(
  prompt: string,
  style: string,
  opts: { dialect?: BeatClipDialect; fromPrevious: boolean },
): string {
  const look = oneLine(beatLoopStyle(style, opts.dialect ?? 'h3'))
  if (!look) throw new Error('A loop keyframe prompt needs a style')
  const body = oneLine(prompt.replaceAll(NO_TEXT_PATTERN, ' '))
  const shot = body ? `${sentence(body)} ${NO_TEXT_LINE}` : NO_TEXT_LINE
  return `${opts.fromPrevious ? KEYFRAME_STYLE_REFERENCE_PREFIX : ''}${shot}\n\nStyle: ${look}`
}

/** Words in a narration line, as a listener hears them ("twenty-five" is one). */
export function narrationWordCount(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length
}

/** How a line's speech fits its 3.45 s: as it is, sped up (at most 1.3x), or not at all. The
 *  rule the voice-over applies, and the one `make_beat_loop` checks every line against. */
export function fitBeatLoopLine(speechSeconds: number): { fits: boolean; tempo: number } {
  const tempo = speechSeconds <= BEAT_LINE_SECONDS ? 1 : speechSeconds / BEAT_LINE_SECONDS
  return { fits: tempo <= BEAT_MAX_SPEEDUP + 1e-9, tempo }
}

/**
 * A cheap guess at how long a voice takes to say a line, before any voice has said it: its
 * syllables at a narrator's pace, plus the pauses voices make at quotes, colons, dashes,
 * commas and full stops. Kokoro Heart said 24 ten-word test lines within about 0.4 s of this
 * (0.7 s at worst), so it only warns; `make_beat_loop` measures the real voice.
 */
export function estimateNarrationSeconds(narration: string): {
  pauseSeconds: number
  seconds: number
  syllables: number
} {
  const text = stripDeliveryMarkup(narration)
  const syllables = text
    .split(/[\s\-‐‑‒–—―]+/)
    .reduce((total, token) => total + tokenSyllables(token), 0)
  const pauseSeconds = PAUSES.reduce((total, pause) => total + pause.count(text) * pause.seconds, 0)
  return {
    pauseSeconds: round2(pauseSeconds),
    seconds: syllables / SYLLABLES_PER_SECOND + pauseSeconds,
    syllables,
  }
}

/**
 * What a line that takes `spokenSeconds` to say should aim for: the words that fit its 3.45 s
 * at about 1.15x (room to spare under 1.3x), never as many as it has nor under the six the
 * check asks for, and without the punctuation it pauses at ("about 8 short words, no quotes or
 * colons").
 */
export function narrationTarget(narration: string, spokenSeconds: number): string {
  const text = stripDeliveryMarkup(narration)
  const words = narrationWordCount(text)
  // At this voice's own pace (the line's words a second), the words 3.45 s holds at 1.15x.
  const fitting = Math.floor((words * BEAT_LINE_SECONDS * TARGET_SPEEDUP) / spokenSeconds)
  const aim = Math.max(NARRATION_WORDS.min, Math.min(fitting, words - 1, NARRATION_WORDS.bestMax))
  const marks = PAUSES.flatMap((pause) => (pause.mark && pause.count(text) ? [pause.mark] : []))
  const leaveOut = marks.length ? `, no ${orList(marks)}` : ''
  return `about ${aim} short words${leaveOut}`
}

/** A line the voice took too long to say, as a storyboard issue: how long it took, the speed
 *  it would need, and what to aim for. */
export function lineTooLongIssue(line: {
  clipId: string
  clipIndex: number
  narration: string
  seconds: number
  /** The voice's name, when the reply should say which voice said it. */
  voice?: string
}): string {
  const { tempo } = fitBeatLoopLine(line.seconds)
  const voice = line.voice ? ` with ${line.voice}` : ''
  return `clips[${line.clipIndex}].narration (${line.clipId}): takes ${line.seconds.toFixed(1)} s to say${voice} and would need ${tempo.toFixed(2)}x speed; at most ${BEAT_MAX_SPEEDUP}x fits the ${BEAT_LINE_SECONDS.toFixed(2)} s a line has. Aim for ${narrationTarget(line.narration, line.seconds)}.`
}

/**
 * Checks a storyboard (an object, or the JSON text the tool receives) and reports every
 * problem at once, as `path: what to fix` lines the writer can act on. Warnings don't block.
 */
export function validateBeatLoopStoryboard(input: unknown): BeatLoopValidation {
  let raw = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { issues: [`storyboard: not valid JSON (${reason})`], ok: false, warnings: [] }
    }
  }
  const warnings = narrationWarnings(raw)
  const parsed = BeatLoopStoryboardSchema.safeParse(raw, { errorMap: plainErrors })
  if (parsed.success) return { issues: [], ok: true, storyboard: parsed.data, warnings }
  const issues = parsed.error.issues.map((issue) => issueLine(issue))
  // zod skips the whole-storyboard checks when a field has the wrong type; run them on the raw
  // input too, so a missing field and a wrong clip count come back in the same reply.
  for (const issue of storyboardIssues(raw)) {
    const line = issueLine(issue)
    if (!issues.includes(line)) issues.push(line)
  }
  return { issues, ok: false, warnings }
}

// ---------- schema ----------

/** Cuts written as abstract transitions turn into slow morphs. */
const ABSTRACT_CUT =
  /\b(?:transition(?:s|ed|ing)? (?:to|into)|fade(?:s|d)? (?:to|into)|becom(?:e|es|ing)|morph(?:s|ed|ing)?|dissolv(?:e|es|ed|ing)|crossfad(?:e|es|ed|ing))\b/gi
/** A camera move on the FREEZE line makes the model treat it as a new shot and cut at 2 s. */
const CAMERA_WORDS =
  /\[|\]|\bcamera\b|\bzoom(?:s|ed|ing)?\b|\bdolly\b|\bwhip[- ]?pan(?:s|ned|ning)?\b|\bpush(?:es|ed|ing)?[- ]in\b|\bpull(?:s|ed|ing)? (?:out|back)\b|\btilt(?:s|ed|ing)? (?:up|down)\b|\bpan(?:s|ned|ning)? (?:left|right)\b/gi
const NO_TEXT_PATTERN = /no text, no labels, no numbers anywhere in this frame\.?/gi
const HEX_COLOUR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i

/** List prices of one keyframe picture on the image roles' models (registry comments):
 *  GPT Image 2.5 Flare on fal is about $0.01-0.04, Nano Banana Pro on Gemini $0.134. */
const KEYFRAME_USD = { fal: 0.04, google: 0.134 } as const

/** Loop clips are made at the model's native mid resolution. */
const LOOP_RESOLUTIONS = ['768p', '720p']

/** A narrator's pace: Kokoro Heart's median over 24 ten-word test lines (3.9-5.6). */
const SYLLABLES_PER_SECOND = 4.6
/** The speed-up a rewritten line aims for: about halfway to the 1.3x limit. */
const TARGET_SPEEDUP = 1.15
/** How many times `pattern` (global) occurs in a text. */
const occurrences =
  (pattern: RegExp) =>
  (text: string): number =>
    text.match(pattern)?.length ?? 0

/** Single quotes used as quotes ('per se', straight or curly): one opening a word and one
 *  closing one, in pairs, so an apostrophe inside a word ("schoolchildren's") or ending one
 *  ("dogs'") is not counted. */
function singleQuoteMarks(text: string): number {
  const opening = occurrences(/(?<![\p{L}\p{N}])['‘](?=[\p{L}\p{N}])/gu)(text)
  const closing = occurrences(/(?<=[\p{L}\p{N}.,!?…])['’](?![\p{L}\p{N}])/gu)(text)
  return 2 * Math.min(opening, closing)
}

/** The pauses voices make at punctuation; the marked ones a rewrite can leave out. */
const PAUSES: readonly { count: (text: string) => number; mark?: string; seconds: number }[] = [
  {
    count: (text) => occurrences(/["“”]/g)(text) + singleQuoteMarks(text),
    mark: 'quotes',
    seconds: 0.25,
  },
  { count: occurrences(/:/g), mark: 'colons', seconds: 0.3 },
  { count: occurrences(/;/g), mark: 'semicolons', seconds: 0.3 },
  // A spaced hyphen, an en or em dash, or two hyphens; never the hyphen inside a word.
  { count: occurrences(/\s[-‐‑‒–—―]+\s|[–—―]|--/g), mark: 'dashes', seconds: 0.3 },
  { count: occurrences(/,/g), seconds: 0.15 },
  // A sentence that ends before the line does.
  { count: occurrences(/[!.?…](?=\s+\S)/g), seconds: 0.3 },
]

const text = z
  .string({ invalid_type_error: 'must be text', required_error: 'is missing' })
  .trim()
  .min(1, 'is empty')

/** Optional text: missing, null and blank all read as null. */
const textOrNull = z
  .string({ invalid_type_error: 'must be text or null' })
  .nullish()
  .transform((value) => value?.trim() || null)

const optionalText = z
  .string({ invalid_type_error: 'must be text' })
  .nullish()
  .transform((value) => value?.trim() || undefined)

const keyframeSchema = z
  .object(
    { id: text, prompt: optionalText, same_as: optionalText },
    { invalid_type_error: 'must be an object like {"id": "f1", "prompt": "..."}' },
  )
  .superRefine((keyframe, ctx) => {
    if (keyframe.prompt && keyframe.same_as)
      ctx.addIssue({ code: 'custom', message: 'set prompt or same_as, not both' })
    else if (!keyframe.prompt && !keyframe.same_as)
      ctx.addIssue({ code: 'custom', message: 'needs a prompt' })
  })

const clipSchema = z.object(
  {
    id: text,
    hit_camera: camera(HIT_CAMERAS),
    hit: text,
    freeze: text.superRefine((freeze, ctx) => {
      const found = unique([...freeze.matchAll(CAMERA_WORDS)].map((m) => m[0].toLowerCase()))
      if (found.length)
        ctx.addIssue({
          code: 'custom',
          message: `no camera words in the freeze (${found.map((w) => JSON.stringify(w)).join(', ')}); the camera stops dead in beat 3, and a camera move there makes the model cut at 2 s`,
        })
    }),
    cut_camera: camera(CUT_CAMERAS),
    cut: text.superRefine((cut, ctx) => {
      const found = unique([...cut.matchAll(ABSTRACT_CUT)].map((m) => m[0].toLowerCase()))
      if (found.length)
        ctx.addIssue({
          code: 'custom',
          message: `write one physical camera move into the next keyframe, not ${found.map((w) => JSON.stringify(w)).join(', ')}; abstract transitions turn into slow morphs`,
        })
    }),
    narration: text.superRefine((narration, ctx) => {
      if (!narration) return
      const digits = narration.match(/\d[\d,.]*/g)
      if (digits)
        ctx.addIssue({
          code: 'custom',
          message: `write numbers as spoken words ("twenty-five sixty"), not digits (${digits.map((d) => JSON.stringify(d.replace(/[,.]$/, ''))).join(', ')}); put the digits in caption or stamp`,
        })
      const count = narrationWordCount(narration)
      if (count < NARRATION_WORDS.min || count > NARRATION_WORDS.max)
        ctx.addIssue({
          code: 'custom',
          message: `${count} words; use ${NARRATION_WORDS.min}-${NARRATION_WORDS.max} (${NARRATION_WORDS.bestMin}-${NARRATION_WORDS.bestMax} fit a clip best)`,
        })
    }),
    caption: textOrNull,
    stamp: textOrNull.superRefine((stamp, ctx) => {
      const length = stamp ? Array.from(stamp).length : 0
      if (length > STAMP_MAX_CHARS)
        ctx.addIssue({
          code: 'custom',
          message: `${length} characters; keep it to ${STAMP_MAX_CHARS}`,
        })
    }),
  },
  {
    invalid_type_error:
      'must be an object with id, hit_camera, hit, freeze, cut_camera, cut, narration, caption and stamp',
  },
)

const durationSchema = z.preprocess(
  toNumber,
  z.custom<BeatLoopLength>(
    (value) => BEAT_LOOP_LENGTHS.includes(value as BeatLoopLength),
    (value) => ({
      fatal: false,
      message:
        value === undefined
          ? 'is missing'
          : `must be 16, 20, 24, 28 or 32 (got ${JSON.stringify(value)})`,
    }),
  ),
)

/** The writer's suggested caption colour, kept for the app to offer: optional, a colour when set. */
const accentSchema = z
  .custom<string>(
    (value) => typeof value === 'string' && HEX_COLOUR.test(value.trim()),
    (value) => ({
      fatal: false,
      message: `must be a colour like #FFE500 (got ${JSON.stringify(value)})`,
    }),
  )
  .transform((value) => {
    const hex = value.trim().toUpperCase()
    return hex.length === 4 ? hex.replaceAll(/[\dA-F]/g, (c) => c + c) : hex
  })
  .nullish()
  .transform((value) => value ?? undefined)

/**
 * The storyboard (skill section 10). Field order is the order problems are listed in. A
 * `caption_style` from an older writer is accepted and dropped: the captions' look is picked
 * in the app.
 */
export const BeatLoopStoryboardSchema: z.ZodType<BeatLoopStoryboard, z.ZodTypeDef, unknown> = z
  .object(
    {
      title: text,
      duration_s: durationSchema,
      style: optionalText,
      accent: accentSchema,
      sources: text,
      voice: optionalText,
      keyframes: z.array(keyframeSchema, {
        invalid_type_error: 'must be a list',
        required_error: 'is missing',
      }),
      clips: z.array(clipSchema, {
        invalid_type_error: 'must be a list',
        required_error: 'is missing',
      }),
    },
    { invalid_type_error: 'must be a JSON object', required_error: 'is missing' },
  )
  .superRefine((storyboard, ctx) => {
    for (const issue of storyboardIssues(storyboard)) ctx.addIssue({ code: 'custom', ...issue })
  })

/** A bracketed or lower-case camera command, read as the name it means ("[push in]"). */
function camera<T extends string>(names: readonly [T, ...T[]]) {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value
      const bare = value
        .replaceAll(/[[\]]/g, ' ')
        .replaceAll('-', ' ')
        .replaceAll(/\s+/g, ' ')
        .trim()
      return names.find((name) => name.toLowerCase() === bare.toLowerCase()) ?? value.trim()
    },
    z.enum(names, {
      errorMap: (_issue, ctx) => ({
        message:
          ctx.data === undefined
            ? 'is missing'
            : `must be one of ${names.join(', ')} (got ${JSON.stringify(ctx.data)})`,
      }),
    }),
  )
}

const cents = (usd: number): number => Math.round(usd * 100) / 100

function duplicateIds(items: unknown[], list: string): FieldIssue[] {
  const seen = new Set<string>()
  const issues: FieldIssue[] = []
  items.forEach((item, index) => {
    const id = isRecord(item) && typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) return
    if (seen.has(id))
      issues.push({ message: `${JSON.stringify(id)} is used twice`, path: [list, index, 'id'] })
    seen.add(id)
  })
  return issues
}

function issueLine(issue: FieldIssue): string {
  return `${pathLabel(issue.path)}: ${issue.message}`
}

/** An object from untyped input, with the fields the checks read by name. */
function isRecord(value: unknown): value is LooseFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVeo(entry: ModelRegistryFile['models'][string] | undefined): boolean {
  const caps = entry && 'capabilities' in entry ? entry.capabilities : undefined
  return (caps as undefined | { family?: string })?.family === 'veo'
}

/**
 * A loop clip model's key, provider and capabilities. A key of the models file is read on its
 * own provider: the resolver would swap another provider's model for the chosen provider's
 * clip model, so an Omni fallback in a fal run (or a price quoted for it) would read H3.
 * Anything else (no model: the `video.firstLast` model) goes through the resolver.
 */
function loopModel(model?: string): {
  capabilities?: VideoCaps
  key: string
  provider: GenerationProvider
} {
  const own = model ? modelRegistry().models[model] : undefined
  if (model && own?.kind === 'video') {
    return { capabilities: own.capabilities, key: model, provider: own.provider }
  }
  const resolved = resolveModel('video', model, { role: 'video.firstLast' })
  return {
    capabilities: resolved.capabilities as undefined | VideoCaps,
    key: resolved.key,
    provider: resolved.provider as GenerationProvider,
  }
}

function loopResolution(caps: undefined | VideoCaps): string {
  const offered = new Set([...(caps?.resolutions ?? []), ...Object.keys(caps?.usdPerSecond ?? {})])
  return (
    LOOP_RESOLUTIONS.find((r) => offered.has(r)) ??
    caps?.resolutions?.[0] ??
    caps?.maxResolution ??
    '720p'
  )
}

/**
 * Early warnings about the lines, before any voice says them: a line the estimate says likely
 * won't fit its 3.45 s even at 1.3x (with what to aim for), else one outside 8-10 words, which
 * still works but fits less well. `make_beat_loop` then measures every line in the real voice.
 */
function narrationWarnings(raw: unknown): string[] {
  const clips = isRecord(raw) && Array.isArray(raw.clips) ? raw.clips : []
  return clips.flatMap((clip, index) => {
    if (!isRecord(clip) || typeof clip.narration !== 'string') return []
    const estimate = estimateNarrationSeconds(clip.narration)
    if (!fitBeatLoopLine(estimate.seconds).fits)
      return [
        `clips[${index}].narration: about ${estimate.seconds.toFixed(1)} s to say, likely too long even at ${BEAT_MAX_SPEEDUP}x speed (a line has ${BEAT_LINE_SECONDS.toFixed(2)} s); aim for ${narrationTarget(clip.narration, estimate.seconds)}`,
      ]
    const count = narrationWordCount(clip.narration)
    const fits = count >= NARRATION_WORDS.bestMin && count <= NARRATION_WORDS.bestMax
    const allowed = count >= NARRATION_WORDS.min && count <= NARRATION_WORDS.max
    return allowed && !fits
      ? [
          `clips[${index}].narration: ${count} words; ${NARRATION_WORDS.bestMin}-${NARRATION_WORDS.bestMax} fit the 3.45 s a line has best`,
        ]
      : []
  })
}

function oneLine(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim()
}

/** "a", "a or b", "a, b or c". */
function orList(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`
}

const round2 = (value: number): number => Math.round(value * 100) / 100

function pathLabel(path: (number | string)[]): string {
  if (!path.length) return 'storyboard'
  return path
    .map((part, i) => (typeof part === 'number' ? `[${part}]` : i === 0 ? part : `.${part}`))
    .join('')
}

/**
 * Plain wording for the problems the schema doesn't word itself. zod applies this map last,
 * with the schema's own message (when it has one) as `defaultError`, so that message is kept;
 * only zod's generic "Expected string, received number" is reworded.
 */
const plainErrors: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code !== 'invalid_type') return { message: ctx.defaultError }
  if (issue.received === 'undefined') return { message: 'is missing' }
  return {
    message: ctx.defaultError.startsWith('Expected ')
      ? `must be ${issue.expected}`
      : ctx.defaultError,
  }
}

/** A slot as one sentence: on one line, ending in a full stop. */
function sentence(value: string): string {
  const line = oneLine(value)
  return !line || /[!.?…]["')\]’”]*$/.test(line) ? line : `${line}.`
}

/** The checks across fields: clip and keyframe counts, ids, and the closing keyframe. Reads
 *  untyped input, so it also runs when zod stopped at a wrong-typed field. */
function storyboardIssues(value: unknown): FieldIssue[] {
  if (!isRecord(value)) return []
  const issues: FieldIssue[] = []
  const duration = toNumber(value.duration_s)
  const clipCount = BEAT_LOOP_LENGTHS.includes(duration as BeatLoopLength)
    ? (duration as number) / BEAT_CLIP_SECONDS
    : null
  if (Array.isArray(value.clips)) {
    if (clipCount !== null && value.clips.length !== clipCount)
      issues.push({
        message: `duration_s ${duration} needs ${clipCount} clips (${BEAT_CLIP_SECONDS} s each); got ${value.clips.length}`,
        path: ['clips'],
      })
    issues.push(...duplicateIds(value.clips, 'clips'))
  }
  if (Array.isArray(value.keyframes)) {
    const keyframes: unknown[] = value.keyframes
    const last = keyframes.length - 1
    const closing = last > 0 && isCopy(keyframes[last])
    if (clipCount !== null && keyframes.length - (closing ? 1 : 0) !== clipCount)
      issues.push({
        message: `${clipCount} clips need ${clipCount} keyframes, or ${clipCount + 1} ending with {"id": "f${clipCount}", "same_as": "f0"}; got ${keyframes.length}`,
        path: ['keyframes'],
      })
    keyframes.forEach((keyframe, index) => {
      if (index !== last && isCopy(keyframe))
        issues.push({
          message: 'only the last keyframe may use same_as; give this one a prompt',
          path: ['keyframes', index],
        })
    })
    const first = keyframes[0]
    const firstId = isRecord(first) && typeof first.id === 'string' ? first.id.trim() : 'f0'
    const closer = keyframes[last]
    if (closing && isRecord(closer) && String(closer.same_as).trim() !== firstId)
      issues.push({
        message: `must name the first keyframe (${JSON.stringify(firstId)}) to close the loop`,
        path: ['keyframes', last, 'same_as'],
      })
    issues.push(...duplicateIds(keyframes, 'keyframes'))
  }
  return issues
}

/** A keyframe that copies another instead of having its own prompt. */
function isCopy(keyframe: unknown): boolean {
  if (!isRecord(keyframe)) return false
  const copies = typeof keyframe.same_as === 'string' && keyframe.same_as.trim() !== ''
  const prompted = typeof keyframe.prompt === 'string' && keyframe.prompt.trim() !== ''
  return copies && !prompted
}

/**
 * Syllables in one spoken word, by the usual English rule of thumb: vowel groups, less a
 * silent final e (and -es, -ed). An initialism ("B.C.", "BBC") is said letter by letter;
 * a digit, as about two syllables.
 */
function tokenSyllables(token: string): number {
  const letters = token.replaceAll(/[^A-Za-z]/g, '')
  const digits = token.replaceAll(/\D/g, '').length
  if (!letters) return digits * 2
  const dotted = /^\W*(?:[A-Za-z]\.){2,}\W*$/.test(token)
  const capitals =
    letters.length > 1 && letters === letters.toUpperCase() && !/[AEIOUY]/.test(letters)
  if (dotted || capitals) return [...letters].reduce((n, c) => n + (/w/i.test(c) ? 3 : 1), 0)
  const word = letters.toLowerCase()
  if (word.length <= 3) return 1 + digits * 2
  const stem = word.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '').replace(/^y/, '')
  return Math.max(1, stem.match(/[aeiouy]{1,2}/g)?.length ?? 0) + digits * 2
}

function toNumber(value: unknown): unknown {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : value
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
