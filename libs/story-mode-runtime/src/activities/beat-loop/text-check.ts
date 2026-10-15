/**
 * The loop's text screen (beat-loop skill, sections 3 and 9): a loop short puts every word on
 * screen in the edit, so its keyframes and clips must carry no letters or numbers at all. Image
 * and video models invent labels ("HISTORICAL MYSTERY 1922") and garble numbers ("1969" as
 * "1.69"). `analyzeTextQuality` only flags garbled title text; this asks about any text,
 * anywhere.
 */
import { completion } from '@reelmakeeasy/common/llm'
import type {
  BeatLoopTextChecker,
  BeatLoopTextVerdict,
} from '@reelmakeeasy/common/long-take/beat-loop-qa'
import { z } from 'zod'

const TextVerdictSchema = z.object({
  hasText: z
    .boolean()
    .describe(
      'True when any letter, digit, word, label, logo or watermark is visible anywhere, at any size',
    ),
  detail: z
    .string()
    .nullable()
    .default(null)
    .describe('What text you see and where, in a few words; null when there is none'),
})

const SYSTEM_PROMPT = `You check pictures made by an AI image or video model for text. The video adds all its words later, so the pictures themselves must carry none.

Answer hasText: true when you can see ANY of these, anywhere in the picture, at any size: letters, words, numbers, digits, dates, labels, captions, signs, logos, watermarks, handwriting, or printed text on objects (newspapers, books, posters, screens, coins, maps).

Not text: shapes, arrows, circles, lines, brush strokes, scribbles and patterns that don't read as letters or digits.`

/** Looks for letters or numbers anywhere in one picture (a local path or a stored URI). */
export async function findBeatLoopText(
  imageUri: string,
  what = 'this picture',
): Promise<BeatLoopTextVerdict> {
  const verdict = await completion({
    contents: [{ imageUrl: imageUri, type: 'image_url' }],
    models: 'flash',
    prompt: `Is there any text, letter or number anywhere in ${what}?`,
    responseFormat: TextVerdictSchema,
    systemPrompt: SYSTEM_PROMPT,
    task: 'beat-loop-text-check',
    temperature: 0,
  })
  return { ...(verdict.detail ? { detail: verdict.detail } : {}), hasText: verdict.hasText }
}

/** The clip QA's text hook: one look at the clip's frame strip (a frame every 0.22 s). */
export const checkBeatLoopClipText: BeatLoopTextChecker = (input) =>
  findBeatLoopText(
    input.stripPath,
    'these frames of one video clip, tiled left to right and top to bottom',
  )
