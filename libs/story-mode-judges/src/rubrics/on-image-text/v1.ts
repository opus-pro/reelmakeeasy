import { z } from 'zod'

import type { GeminiVisionParams, JudgeContext, JudgeVersion } from '../../types'

const BASE_PROMPT = `\
Read every piece of legible text rendered in this image, and report any brand identity it shows.

Report:
- observed_text: every readable string burned into the image, verbatim. Include copy printed on \
props (flyers, posters, signs, menus, labels, packaging, book covers, cards) and text shown on \
screens inside the scene. Exclude text you cannot actually read.
- brand_marks: any company name, wordmark, logo, or brand-name lockup that appears, whether or \
not you recognize it as a real company.

Do not describe the scene, the style, or anything you cannot read. Report only what is legible.`

const UNSUPPORTED_TEXT_INSTRUCTION = `\

Then decide whether that text belongs here.

This frame was generated for the shot described below. Legible text is SUPPORTED when it appears \
in, or is a clear paraphrase of, the shot description or the listed key entities. It is \
UNSUPPORTED when the image shows a brand, business, product name, or slogan that nothing below \
asked for. An unsupported brand name on a prop means the generator invented an identity, which is \
the failure this rubric exists to catch.

Set unsupported_text to true only when at least one legible string names a brand, business, \
product, or establishment that the shot description and key entities do not mention. Incidental \
lettering you cannot tie to any real-world identity is not by itself unsupported. When in doubt, \
answer false.`

const REQUESTED_TEXT_INSTRUCTION = `\

The shot description may also call for specific text to appear: a sign, a label, a title, a \
headline, a board, a screen, packaging. For each string the description asks for, compare it with \
the legible text you read.

Set requested_text_defect to true when a requested string is misspelled, garbled, truncated, or \
absent from the image, for example the description asks for a board reading "sprint board" and the \
image shows "SPRIM". An object the description names without spelling out what it should read is \
not a requested string. Report each problem in requested_text_issues as "<expected>" rendered as \
"<observed>", or "<expected>" missing. When in doubt, answer false.`

function buildOnImageTextPrompt(context: JudgeContext | undefined): string {
  return `${BASE_PROMPT}${renderShotIntent(context)}

Set reason to the strings that drove your verdict: when requested_text_defect is true, the \
requested_text_issues entries joined by "; ", followed by the unsupported strings if there are \
any; otherwise the unsupported ones when unsupported_text is true, otherwise every string you \
read, joined by "; ". Leave it empty only when the image has no legible text at all. It is the \
only field a human reviewing this verdict will see.

Reply with ONLY a JSON object: {"observed_text": ["..."], "brand_marks": ["..."], "unsupported_text": false, "requested_text_issues": ["..."], "requested_text_defect": false, "reason": "..."}`
}

function renderShotIntent(context: JudgeContext | undefined): string {
  if (!context) {
    return ''
  }
  const lines = [
    context.shotPrompt ? `Shot description: ${context.shotPrompt}` : null,
    context.keyEntities && context.keyEntities.length > 0
      ? `Key entities: ${context.keyEntities.join(', ')}`
      : null,
    context.brandScope ? `Brand this video may depict: ${context.brandScope}` : null,
  ].filter((line): line is string => line !== null)
  if (lines.length === 0) {
    return ''
  }
  const instruction = context.shotPrompt
    ? `${UNSUPPORTED_TEXT_INSTRUCTION}\n${REQUESTED_TEXT_INSTRUCTION}`
    : UNSUPPORTED_TEXT_INSTRUCTION
  return `${instruction}\n\n${lines.join('\n')}`
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * Flags a keyframe whose legible text names a brand or business the shot
 * never asked for, or whose requested text is misspelled, garbled, or
 * missing.
 *
 * With no context the rubric still runs and still reports what it read, but
 * it cannot judge support against a shot. A requested_text_defect the model
 * volunteers still fails the frame.
 */
export const onImageTextV1: JudgeVersion<GeminiVisionParams> = {
  params: {
    buildPrompt: buildOnImageTextPrompt,
    mapResult: (raw) => ({
      details: {
        brandMarks: toStringArray(raw['brand_marks']),
        observedText: toStringArray(raw['observed_text']),
        requestedTextIssues: toStringArray(raw['requested_text_issues']),
      },
      pass: raw['unsupported_text'] !== true && raw['requested_text_defect'] !== true,
    }),
    model: 'gemini-3-flash-preview',
    prompt: buildOnImageTextPrompt(undefined),
    responseSchema: z.object({
      brand_marks: z.array(z.string()).default([]),
      observed_text: z.array(z.string()).default([]),
      // Carries the strings themselves to every consumer. JudgeResult has no
      // slot for structured detections, but the runner copies `reason`
      // straight through, so a verdict is never reported without the text
      // that caused it.
      reason: z.string().default(''),
      requested_text_defect: z.boolean().default(false),
      requested_text_issues: z.array(z.string()).default([]),
      unsupported_text: z.boolean().default(false),
    }),
  },
  rubricId: 'on-image-text',
  runner: 'gemini-vision-v1',
  thresholds: { pass: 4 },
  version: 'v1',
}
