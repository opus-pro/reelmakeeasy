import {
  BEAT_CLIP_SECONDS,
  CUT_CAMERAS,
  HIT_CAMERAS,
  NARRATION_WORDS,
  narrationWordCount,
} from '@reelmakeeasy/common/long-take/beat-loop-craft'
import type { BeatLoopLength } from '@shared/types/api/agent'

import { beatLoopSkillBody } from '../craft/beat-loop-skill'

/** Easy's length card for a loop: the lengths, the first (the skill's default, 24 s)
 *  recommended. */
export const EASY_LOOP_LENGTHS = [24, 28, 32] as const satisfies readonly BeatLoopLength[]
/** What each loop length holds, in clips (one per 4 seconds). */
export const LOOP_LENGTH_DESCRIPTIONS: Record<(typeof EASY_LOOP_LENGTHS)[number], string> = {
  24: '6 clips: a hook, four facts and a twist.',
  28: '7 clips: one more fact before the twist.',
  32: '8 clips: two more facts, for a fuller story.',
}
/** The length card's info line for a loop. */
export const LOOP_LENGTH_INFO = `Each clip is ${BEAT_CLIP_SECONDS} seconds, so a longer loop has more clips. More clips take longer to make and cost more.`

/** Easy's camera card option that makes a loop short instead of a story video (its length is
 *  asked next). */
export const BEAT_LOOP_CAMERA_OPTION = {
  description: "Hit, hit, freeze, cut: a short loop with the clips' own sounds.",
  label: 'Beat loop',
} as const

/** Every label the loop option had: a chat picked up after a restart may show an older one. */
export const BEAT_LOOP_CAMERA_LABELS: readonly string[] = [
  BEAT_LOOP_CAMERA_OPTION.label,
  'Beat loop (1-2-3-4)',
]

/** The camera card's info line about the loop, after Calm and Dynamic's. */
export const BEAT_LOOP_CAMERA_INFO = `Beat loop makes a short of ${EASY_LOOP_LENGTHS[0]} to ${EASY_LOOP_LENGTHS[EASY_LOOP_LENGTHS.length - 1]} seconds that replays seamlessly: every ${BEAT_CLIP_SECONDS} seconds two hits, a freeze and a fast cut.`

/** The music card's info for a loop: its clips carry their own sound, so music is optional. */
export const BEAT_LOOP_MUSIC_INFO =
  "A loop already has its clips' own sounds under the voice, so it needs no music. Music, when you pick it, goes under both once the loop is made."

/** How many times Easy asks the writer for a loop before the step fails (a "Try again" card). */
export const LOOP_WRITE_ROUNDS = 3

/** The hook as the loop's first line when it already is one (no digits, the right length);
 *  otherwise null, and the writer adapts it. */
export function hookAsFirstLine(opening: string | undefined): null | string {
  const line = opening?.trim() ?? ''
  if (!line || /\d/.test(line)) return null
  const words = narrationWordCount(line)
  return words >= NARRATION_WORDS.min && words <= NARRATION_WORDS.max ? line : null
}

/**
 * Easy's loop writer (a quiet turn): the chosen idea's brief and hook -> a loop storyboard of
 * the picked length (`seconds`: one clip per 4 seconds) as JSON. The skill is embedded (Easy has no Skill tool). `problems` are the
 * last answer's issues (storyboard checks, lines too long to say), to fix in this one. Once
 * the first line took too long to say (`openingTooLong`), the hook is no longer word for word:
 * the writer shortens it.
 */
export function beatLoopWriterPrompt(input: {
  brief: string
  opening?: string
  openingTooLong?: boolean
  previous?: string
  problems?: readonly string[]
  seconds: BeatLoopLength
  title: string
}): string {
  const clips = input.seconds / BEAT_CLIP_SECONDS
  const hook = input.opening?.trim()
  const fix = input.problems?.length
    ? [
        '',
        'Your last storyboard had these problems. Fix every one and answer the whole storyboard again:',
        ...input.problems.map((problem) => `- ${problem}`),
        ...(input.previous ? ['', 'Your last storyboard:', input.previous] : []),
      ]
    : []
  return [
    `Write the storyboard of a ${input.seconds}-second loop short (${clips} clips of ${BEAT_CLIP_SECONDS} seconds) for this video, following the guide below.`,
    '',
    `Title: ${input.title}`,
    'Brief:',
    input.brief,
    ...(hook ? ['', openingRule(hook, input.openingTooLong === true)] : []),
    '',
    `Rules: exactly ${clips} clips and ${clips + 1} keyframes, the last one {"id": "f${clips}", "prompt": null, "same_as": "f0"} (every other keyframe has a prompt and "same_as": null). Each clip's hit_camera is one of ${HIT_CAMERAS.join(', ')}; its cut_camera one of ${CUT_CAMERAS.join(', ')}. Narration lines are ${NARRATION_WORDS.bestMin}-${NARRATION_WORDS.bestMax} short, easy words, numbers written as spoken words, and no quotes, colons or dashes. Leave out style and voice: the user picks the look and ReelMakeEasy the voice. caption and stamp are null when there is nothing to show; sources says where the facts come from.`,
    'Fact-check every claim with web search before you write it, and keep only what reputable sources confirm.',
    ...fix,
    '',
    'Answer with the storyboard JSON only. Write in English. Do not ask questions, call tools other than web search, run commands or change files.',
    '',
    '---',
    '',
    beatLoopSkillBody(),
  ].join('\n')
}

/** What the writer does with the hook: keep it word for word, or, once it took too long to
 *  say, shorten it. */
function openingRule(hook: string, tooLong: boolean): string {
  return tooLong
    ? `Clip 1's narration starts from this opening line: "${hook}". It takes too long to say in its clip, so shorten it to ${NARRATION_WORDS.bestMin}-${NARRATION_WORDS.bestMax} short words, keeping its idea.`
    : `Clip 1's narration is this opening line, word for word: "${hook}". Write any digits in it as spoken words; only when it has fewer than ${NARRATION_WORDS.min} or more than ${NARRATION_WORDS.max} words, change it as little as you can to fit.`
}

const nullableText = { type: ['string', 'null'] }

/** The writer's `outputSchema` (strict: every object closed, every property required). The
 *  length, style and voice are ReelMakeEasy's, so they are not asked for. */
export const BEAT_LOOP_STORYBOARD_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    accent: nullableText,
    clips: {
      items: {
        additionalProperties: false,
        properties: {
          caption: nullableText,
          cut: { type: 'string' },
          cut_camera: { enum: [...CUT_CAMERAS], type: 'string' },
          freeze: { type: 'string' },
          hit: { type: 'string' },
          hit_camera: { enum: [...HIT_CAMERAS], type: 'string' },
          id: { type: 'string' },
          narration: { type: 'string' },
          stamp: nullableText,
        },
        required: [
          'id',
          'hit_camera',
          'hit',
          'freeze',
          'cut_camera',
          'cut',
          'narration',
          'caption',
          'stamp',
        ],
        type: 'object',
      },
      type: 'array',
    },
    keyframes: {
      items: {
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          prompt: nullableText,
          same_as: nullableText,
        },
        required: ['id', 'prompt', 'same_as'],
        type: 'object',
      },
      type: 'array',
    },
    sources: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['title', 'sources', 'accent', 'keyframes', 'clips'],
  type: 'object',
}
