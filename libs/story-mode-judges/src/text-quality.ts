import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { completion, type Content } from '@reelmakeeasy/common/llm'
import { z } from 'zod'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Schemas (aligned with scripts/analysis/analyze-storymode-text-quality.ts)
// ---------------------------------------------------------------------------

const DominantTextDetectionSchema = z.object({
  hasDominantText: z
    .boolean()
    .describe(
      'Whether the image contains visually dominant text (large, high-contrast, clearly meant to be read)',
    ),
  dominantTextDescription: z
    .string()
    .nullable()
    .default(null)
    .describe('Brief description of the dominant text found, or null if none'),
})

const TextQualityAnalysisSchema = z.object({
  hasText: z.boolean().describe('Whether visually dominant text exists in the image'),
  hasGibberish: z.boolean().describe('Whether dominant text is corrupted or unreadable'),
  distortionTypes: z
    .array(
      z.enum([
        'twisted',
        'blurry',
        'overlapping',
        'unreadable',
        'missing-strokes',
        'wrong-font',
        'typo',
      ]),
    )
    .describe('Types of distortion found in dominant text'),
  severity: z.enum(['none', 'minor', 'moderate', 'severe']).describe('Severity of text issues'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence in this severity assessment'),
  description: z.string().describe('Brief description of the text quality issues found'),
  detectedText: z.string().nullable().default(null).describe('The dominant text you can read'),
})

export type TextQualityAnalysis = z.infer<typeof TextQualityAnalysisSchema>

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const STAGE1_SYSTEM_PROMPT = `You are reviewing an AI-generated image.

Your only job: determine if this image contains INTENTIONAL TITLE/HEADLINE text that was placed in the image to be read by the viewer.

This means: a title card, headline banner, large caption box, or prominent label that the artist deliberately put there to communicate a message. It must occupy a significant portion of the frame and be the primary communicative purpose of that region.

NEVER count any of these — return hasDominantText: false:
- Logos, brand marks, or text printed on objects (lamps, products, clothing, signs in the background)
- Text on props: newspapers, books, letters, documents, posters on walls
- Speech bubbles, thought bubbles, or dialogue boxes — these are scene elements, not title text
- Any text that is part of the scene's world (diegetic text) rather than overlaid on top
- Small or decorative text, watermarks, copyright marks
- Handwriting or calligraphy that is part of a scene prop
- Background text that you have to look carefully to notice
- Abstract marks or brush strokes resembling letters

Ask yourself: "Was this text placed here by the video creator to serve as a title or caption overlay?" If the answer is anything other than a clear YES → hasDominantText: false`

const STAGE2_SYSTEM_PROMPT = `You are reviewing an AI-generated image for text rendering failures.

The image contains visually dominant text (large, prominent, clearly meant to be read). Evaluate its quality.

**Severity:**
- none: readable, even if slightly rough
- minor: slightly imperfect but legible
- moderate: noticeably corrupted, hard to read
- severe: clearly garbled characters, severe distortion, or obvious typo/misspelling

**Not a defect:**
- Text partially hidden behind an overlapping element (popup, object) — intentional composition
- Secondary/small text being unreadable — only dominant text matters

**Confidence** (how certain are you about this severity rating?):
- high: obvious, no ambiguity
- medium: reasonable assessment but some uncertainty
- low: hard to tell

**distortionTypes** (for dominant text only):
- twisted: letters warped out of shape
- blurry: significantly out of focus
- overlapping: two text layers on top of each other
- unreadable: characters too corrupted to decode
- missing-strokes: character strokes missing due to AI rendering failure (NOT occlusion)
- wrong-font: severe unintended font inconsistency
- typo: wrong or misspelled word`

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Two-stage VLM check for gibberish/distorted text in an image.
 * Stage 1: detect dominant title/headline text (excludes diegetic/prop text).
 * Stage 2: evaluate distortion severity (none/minor/moderate/severe).
 */
export async function analyzeTextQuality(imageUrl: string): Promise<TextQualityAnalysis> {
  const contents: Content[] = [{ type: 'image_url', imageUrl }]

  const stage1 = await completion({
    models: 'flash',
    contents,
    prompt: 'Does this image contain visually dominant text?',
    systemPrompt: STAGE1_SYSTEM_PROMPT,
    responseFormat: DominantTextDetectionSchema,
    task: 'storymode-text-quality-stage1',
    temperature: 0.1,
  })

  if (!stage1.hasDominantText) {
    return {
      hasText: false,
      hasGibberish: false,
      distortionTypes: [],
      severity: 'none',
      confidence: 'high',
      description: stage1.dominantTextDescription ?? 'No dominant text found',
      detectedText: null,
    }
  }

  return await completion({
    models: 'flash',
    contents,
    prompt: `Evaluate the quality of the dominant text: "${stage1.dominantTextDescription}"`,
    systemPrompt: STAGE2_SYSTEM_PROMPT,
    responseFormat: TextQualityAnalysisSchema,
    task: 'storymode-text-quality-stage2',
    temperature: 0.1,
  })
}

/**
 * Extracts the middle frame of a video file to a PNG image using ffmpeg/ffprobe.
 */
export async function extractMiddleFrame(videoPath: string, outputPath: string): Promise<void> {
  const duration = await getVideoDurationSeconds(videoPath)
  const midpoint = duration > 0 ? duration / 2 : 0

  await execFileAsync('ffmpeg', [
    '-ss',
    String(midpoint),
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    '-y',
    outputPath,
  ])
}

async function getVideoDurationSeconds(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ])
    if (!stdout) {
      return 0
    }
    const duration = Number.parseFloat(stdout.trim())
    return Number.isFinite(duration) ? duration : 0
  } catch {
    return 0
  }
}
