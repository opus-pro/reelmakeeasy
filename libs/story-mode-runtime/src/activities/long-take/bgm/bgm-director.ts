import { completion, type ModelChain } from '@reelmakeeasy/common/llm'
import { z } from 'zod'

// Structured-output models for the director. Mirrors the visual-script
// generator's set (gemini-first, gpt-5 fallback) -- a small JSON-shaped task.
const BGM_DIRECTOR_MODELS = [
  'gemini-3.8-flash',
  'gemini-2.5-pro',
  'gpt-5',
] as const satisfies ModelChain

// The director is mildly creative but must stay on-contract; a moderate
// temperature gives variety across regenerations without drifting off-brief.
const BGM_DIRECTOR_TEMPERATURE = 0.7

const BGM_DIRECTOR_TASK = 'long-take-bgm-director'

/**
 * The director's structured output. `responseFormat` forces every field; the schema
 * descriptions are the contract.
 */
export const BgmDirectorResponseSchema = z.object({
  prompt: z
    .string()
    .describe(
      "The text-to-music prompt (Lyria). 1-2 sentences, 15-35 words: lo-fi or piano house sound, energy from camera_style, no vocals. Ends with 'Instrumental.'",
    ),
  tags: z
    .string()
    .describe(
      "The same music as comma-separated style tags for tag-based models (ACE-Step): genre, mood, 3-5 instruments, '<n> bpm', and always 'instrumental' last. 6-10 short tags, no sentences.",
    ),
  target_bpm: z.number().describe('Suggested tempo in BPM for the bed.'),
  notes: z.string().describe('1 line: the sound chosen and why.'),
  trackName: z
    .string()
    .describe(
      'A short, human-friendly track name (2-4 words) shown per-version in the editor, e.g. "Warm Marimba Glow".',
    ),
})

export type BgmDirectorResponse = z.infer<typeof BgmDirectorResponseSchema>

/**
 * Report fields the director reasons over. All optional: on degraded runs the
 * activity may only recover a subset (e.g. `global_constraints.json` can be
 * absent). The director leans on useCase/video_type + tone + topic first.
 */
export interface BgmReportFields {
  brandScope?: string
  /** The video's camera style: calm, or dynamic (a gentle pulse, never aggressive). */
  cameraStyle?: string
  durationSec?: number
  hasVoiceover?: boolean
  keyEntities?: string[]
  numShots?: number
  numTransitions?: number
  scriptCategory?: string
  styleName?: string
  styleText?: string
  targetAudience?: string
  thematicCore?: string
  tone?: string
  topic?: string
  /** High-level job of the video (ad / explainer / b-roll / narrative / audio-to-video). */
  useCase?: string
  /** The user's own wish for the music (a preset mood or their words); outranks the genre table. */
  userRequest?: string
  videoType?: string
}

/**
 * The music director's system prompt (v4). Our videos are calm-paced explainers and
 * stories, so the house sound is easy-to-like lo-fi or piano that fits almost anything; the
 * camera style only sets the energy. v3 asked for a "sparse, mid-scooped, no build" bed
 * and let the visual style add instruments, which gave aimless, odd-sounding music; v4
 * asks for real music (a melody and a groove) from a few common instruments.
 */
export const BGM_DIRECTOR_SYSTEM_PROMPT = `# Music Director (v4)
You choose the background music for a short vertical video with a narrator: an instrumental track that sits under the voice and makes the video pleasant to watch. Output ONE text-to-music prompt and the same music as short style tags.

## House sound
Our videos are calm-paced explainers and stories. Default to warm, easy-to-like music that fits almost anything: lo-fi hip hop, lo-fi piano, or soft piano with light drums. Pleasant chords, a simple melody or hook, a gentle steady groove. Never harsh, aggressive, horror, comedic or cartoonish.

## Energy from camera_style
- calm → 68-80 BPM, mellow and soft: lo-fi with soft drums, or piano-led.
- dynamic → 84-96 BPM, a little brighter with a clearer groove (crisper drums, a round bass), still relaxed: the camera moves more, the music stays friendly.
- missing → treat as calm.

## Mood from the content
Use tone, topic and thematic_core only to nudge the mood (nostalgic, hopeful, curious, reflective, bright) inside the house sound. Serious or emotional topics lean piano-led; light or fun topics lean brighter lo-fi.

## User request
If \`user_request\` is present it outranks the house sound: follow its genre, mood, tempo and instruments, and keep only the rules below.

## Rules
- Instrumental only: no vocals, lyrics or spoken word.
- Real music with a melody and a groove, not ambient filler. Keep the energy steady: no long silences, no dramatic stops.
- Ignore the visual style (style_name, style_text): it never picks the genre or adds instruments.
- 3-5 common instruments (piano, electric piano or Rhodes, soft drums, bass, clean guitar, light pads). No unusual textures or sound effects.
- Describe the music, not the video's story.

## Return STRICT JSON only
{
  "prompt": "1-2 sentences, 15-35 words, ends with 'Instrumental.'",
  "tags": "6-10 short comma-separated tags: genre, mood, 3-5 instruments, '<n> bpm', and 'instrumental' last",
  "target_bpm": 0,
  "notes": "1 line: the sound chosen and why",
  "trackName": "2-4 words"
}`

/** One labelled `key: value` line, omitted entirely when the value is empty. */
function field(label: string, value: number | string | undefined): string | undefined {
  if (value === undefined || value === '') {
    return undefined
  }
  return `${label}: ${String(value)}`
}

/**
 * Renders the recovered report fields into the director's user prompt. Only
 * present fields are listed, so a degraded run yields a shorter (still valid)
 * brief rather than a wall of "unknown".
 */
export function buildBgmDirectorPrompt(fields: BgmReportFields): string {
  const lines = [
    // The user's wish first: the system prompt says it outranks everything below.
    field('user_request', fields.userRequest),
    field('camera_style', fields.cameraStyle),
    field('useCase', fields.useCase),
    field('video_type', fields.videoType),
    field('tone', fields.tone),
    field('script_category', fields.scriptCategory),
    field('topic', fields.topic),
    field('thematic_core', fields.thematicCore),
    field('key_entities', fields.keyEntities?.join(', ')),
    field('brand_scope', fields.brandScope),
    field('target_audience', fields.targetAudience),
    field('style_name', fields.styleName),
    field('style_text', fields.styleText),
    field('duration_seconds', fields.durationSec),
    field('num_shots', fields.numShots),
    field('num_transitions', fields.numTransitions),
    field(
      'has_voiceover',
      fields.hasVoiceover === undefined ? undefined : String(fields.hasVoiceover),
    ),
  ].filter((line): line is string => line !== undefined)

  return `Video metadata:\n${lines.join('\n')}`
}

/** Report fields -> a text-to-music prompt, style tags and a short track name, via the v4 director. */
export async function directBgm(fields: BgmReportFields): Promise<BgmDirectorResponse> {
  return completion({
    models: BGM_DIRECTOR_MODELS,
    systemPrompt: BGM_DIRECTOR_SYSTEM_PROMPT,
    prompt: buildBgmDirectorPrompt(fields),
    responseFormat: BgmDirectorResponseSchema,
    task: BGM_DIRECTOR_TASK,
    temperature: BGM_DIRECTOR_TEMPERATURE,
  })
}

const BGM_TRACK_NAME_TASK = 'long-take-bgm-track-name'

// Shown in the music panel when a name can't be generated; a paid Lyria
// generation must never fail over its display label.
export const BGM_FALLBACK_TRACK_NAME = 'Custom Mix'

export const BgmTrackNameSchema = z.object({
  trackName: z
    .string()
    .describe(
      'A short, human-friendly instrumental track name (2-4 words), e.g. "Warm Marimba Glow". No quotes, no genre labels like "(Jazz)".',
    ),
})

const BGM_TRACK_NAME_SYSTEM_PROMPT =
  'You name instrumental background-music tracks for a video editor. Given the text-to-music prompt that produced the track, return a short evocative track name (2-4 words) that matches its mood and instrumentation. Return STRICT JSON only: {"trackName": "..."}'

/**
 * Name a bed generated from a user-edited prompt, where the director
 * (the usual trackName source) was skipped. Naming is cosmetic, so any failure
 * falls back to a static label instead of failing the paid generation.
 */
export async function nameBgmTrack(lyriaPrompt: string): Promise<string> {
  try {
    const result = await completion({
      models: BGM_DIRECTOR_MODELS,
      systemPrompt: BGM_TRACK_NAME_SYSTEM_PROMPT,
      prompt: `Text-to-music prompt:\n${lyriaPrompt}`,
      responseFormat: BgmTrackNameSchema,
      task: BGM_TRACK_NAME_TASK,
      temperature: BGM_DIRECTOR_TEMPERATURE,
    })
    const trackName = result.trackName.trim()
    return trackName === '' ? BGM_FALLBACK_TRACK_NAME : trackName
  } catch {
    return BGM_FALLBACK_TRACK_NAME
  }
}
