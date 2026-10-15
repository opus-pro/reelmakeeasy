/**
 * Prompt for a Hailuo 3 first-and-last-frame clip.
 *
 * Hailuo already sees both frames, so the prompt only says what happens
 * between them: one continuous shot, one camera move, and the motion that
 * carries the first frame into the last. Timestamps, shot numbers and titles
 * read to Hailuo as a shot list and come back as hard cuts, so the prompt is a
 * single plain paragraph.
 */

import type { ModelChain } from '@reelmakeeasy/common/llm/completion'
import {
  buildDynamicTransitionRewritePrompt,
  cameraMoveFor,
  cameraSeed,
  type CameraStyle,
  cleanDynamicTransitionPrompt,
  hailuoGenerationSeconds,
  retimeMaxSpeedFor,
} from '@reelmakeeasy/common/long-take/camera-craft'

export interface HailuoTransitionPromptInput {
  durationSeconds: number
  /** Planned motion for the outgoing shot. */
  fromMotion?: string
  /** What the first frame shows (the outgoing keyframe prompt). */
  fromScene?: string
  /** Narration spoken during the clip. */
  narration?: string
  /** Free-form brief, used when the structured fields are unavailable. */
  notes?: string
  /** Planned motion for the incoming shot. */
  toMotion?: string
  /** What the last frame shows (the incoming keyframe prompt). */
  toScene?: string
}

const MAX_PROMPT_CHARS = 900

export function buildHailuoTransitionRewritePrompt(input: HailuoTransitionPromptInput): string {
  const seconds = Number.isFinite(input.durationSeconds) ? Math.round(input.durationSeconds) : 5
  const line = (label: string, value?: string) => (value?.trim() ? `${label}: ${value.trim()}` : '')
  const motion = [input.fromMotion, input.toMotion]
    .map((m) => m?.trim())
    .filter(Boolean)
    .join(' ')
  return [
    'You write the prompt for one Hailuo 3 video clip made from a first frame and a last frame.',
    '',
    'The FIRST attached image is the first frame and the SECOND is the last frame. The video model sees both images, so never describe how things look. Describe only what happens between them.',
    '',
    `Clip length: ${seconds} seconds`,
    line('First frame shows', input.fromScene),
    line('Last frame shows', input.toScene),
    line('Planned motion', motion),
    line('Narration during the clip', input.narration),
    line('Notes', input.notes),
    '',
    'Write one paragraph of 40 to 80 words, in the present tense, describing a single continuous shot from the first frame to the last:',
    '- One camera move, e.g. a slow push-in, dolly left, crane up, or slow arc.',
    '- How the subjects move, and how the elements of the first frame physically turn into, or make way for, the elements of the last frame: sliding, turning, rising, entering or leaving the frame. Every change is visible motion, never a jump.',
    '- Name characters and objects by what they are ("the pharaoh", "the two queens", "the stone tablet"), not by appearance details the images already show.',
    '- Keep the lighting, colours and art style of the images. Add no light, shadows, text or objects that are in neither image.',
    '',
    'Never write timestamps, shot numbers, titles, headings, lists, "cut to" or "transition". Return only the paragraph.',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n')
}

/**
 * One plain paragraph: strips timestamps, shot labels and headings a model
 * may still emit, since Hailuo turns them into cuts.
 */
export function cleanHailuoTransitionPrompt(text: string): string {
  const cleaned = text
    .replaceAll(/["“”]/g, '')
    .replaceAll(/\[[^\]]*\d:\d[^\]]*\]/g, ' ')
    .replaceAll(/\[?\bshot\s*\d+\]?:?/gi, ' ')
    .replaceAll(/\bat\s+\d{1,2}:\d{2}(?:\.\d+)?,?\s*/gi, '')
    .split('\n')
    .map((l) =>
      l
        .trim()
        .replace(/^[A-Z0-9][A-Z0-9 ,'&:-]{5,}(?=\s+[A-Z][a-z])/, '')
        .trim(),
    )
    .filter((l) => l && !/^[A-Z0-9 ,'&:-]{6,}$/.test(l))
    .join(' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= MAX_PROMPT_CHARS) return cleaned
  const cut = cleaned.slice(0, MAX_PROMPT_CHARS)
  const sentenceEnd = cut.lastIndexOf('. ')
  return sentenceEnd > 0 ? cut.slice(0, sentenceEnd + 1) : cut
}

/** Used when the rewrite call fails: the planned motion as one continuous shot. */
export interface HailuoRewriteInput extends HailuoTransitionPromptInput {
  beatBoundarySeconds?: number
  cameraStyle?: CameraStyle | null
  /** Position of this clip in the video, for the camera-move rotation. */
  clipIndex?: number
  projectId: string
  styleText?: null | string
  /** The planner's transition brief (`buildSeedance2TransitionPrompt`). */
  visualScript?: string
}

export interface HailuoRewriteRequest {
  clean: (text: string) => string
  models: ModelChain
  prompt: string
  task: string
  temperature?: number
}

export function fallbackHailuoTransitionPrompt(input: HailuoTransitionPromptInput): string {
  const motion = [input.fromMotion, input.toMotion]
    .map((m) => m?.trim())
    .filter(Boolean)
    .join(' ')
  return cleanHailuoTransitionPrompt(
    `A single continuous shot as the camera slowly pushes in. ${motion || 'The scene moves smoothly from the first frame to the last.'}`,
  )
}

/** The planner's brief states narration and music timing in slot seconds; the Dynamic prompt
 *  restates the narration edge in the generated clip's time, so those lines would conflict. */
const SLOT_TIMING_LINE = /inside this clip:/

/**
 * The rewrite call for one Hailuo 3 clip. Calm is the one-paragraph prompt above, unchanged.
 * Dynamic writes timed beats in the generated clip's time: Hailuo makes whole seconds (5-15)
 * and the clip is retimed to its slot afterwards (sped up at most `retimeMaxSpeedFor`, then
 * trimmed), so the narration edge is scaled by the speed the clip will really play at.
 */
export function hailuoRewriteRequest(input: HailuoRewriteInput): HailuoRewriteRequest {
  if (input.cameraStyle !== 'dynamic') {
    return {
      clean: cleanHailuoTransitionPrompt,
      models: ['gemini-3.8-flash', 'gpt-5'],
      prompt: buildHailuoTransitionRewritePrompt(input),
      task: 'long-take-hailuo-prompt',
    }
  }
  const slot =
    Number.isFinite(input.durationSeconds) && input.durationSeconds > 0 ? input.durationSeconds : 5
  const generated = hailuoGenerationSeconds(slot)
  const speed = Math.min(generated / slot, retimeMaxSpeedFor('dynamic'))
  const boundary =
    input.beatBoundarySeconds === undefined
      ? undefined
      : Number((input.beatBoundarySeconds * speed).toFixed(3))
  const line = (label: string, value?: string) => (value?.trim() ? `${label}: ${value.trim()}` : '')
  const visualScript =
    input.visualScript
      ?.split('\n')
      .filter((l) => !SLOT_TIMING_LINE.test(l))
      .join('\n')
      .trim() ||
    [
      line('Outgoing keyframe', input.fromScene),
      line('Outgoing motion', input.fromMotion),
      line('Incoming keyframe', input.toScene),
      line('Incoming motion', input.toMotion),
      line('Narration', input.narration),
      line('Notes', input.notes),
    ]
      .filter(Boolean)
      .join('\n')
  const { move, previousMove } = cameraMoveFor(input.clipIndex ?? 0, cameraSeed(input.projectId))
  return {
    clean: (text) => cleanDynamicTransitionPrompt(text),
    models: ['gemini-3.1-pro-preview', 'gemini-3.8-flash'],
    prompt: buildDynamicTransitionRewritePrompt({
      beatBoundarySeconds: boundary,
      durationSeconds: generated,
      move,
      previousMove,
      vibe: input.styleText,
      visualScript,
    }),
    task: 'long-take-hailuo-dynamic-prompt',
    temperature: 0.3,
  }
}
