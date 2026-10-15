import { JobContext } from '@reelmakeeasy/common/job-context'
import { completion } from '@reelmakeeasy/common/llm'
import { z } from 'zod'

import type {
  GenerateV4ScriptActivityParams,
  GenerateV4ScriptActivityResult,
} from '../../workflows/long-take/types'

import { formatLogFields, logger, withActivityHeartbeat, withLongTakeContext } from './common'

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

// Temperature for script generation.
const V4_GEN_TEMPERATURE = 0.7

// Absolute hard cap on output length, regardless of inferred category --
// enforced by the downstream TTS vendor's per-video word limit.
const ABSOLUTE_MAX_WORDS = 300

// ---------------------------------------------------------------------------
// Prompt builder (single short prompt; classification, length budgeting, and
// generation are all done in one LLM call)
// ---------------------------------------------------------------------------

interface BuildV4GenerationPromptParams {
  /** When the user explicitly requested a length, the runtime fills these
   *  and the prompt pins to that exact budget. When omitted, the prompt
   *  self-picks the budget from the category table. */
  explicitMaxWords?: number
  explicitTargetWords?: number
  rawInput: string
}

function buildV4GenerationPrompt(params: BuildV4GenerationPromptParams): string {
  const { explicitMaxWords, explicitTargetWords, rawInput } = params

  const wordBudgetBlock =
    explicitTargetWords && explicitMaxWords
      ? `5. Word budget: the user explicitly requested this length. Aim for ~${explicitTargetWords} words. Hard cap at ${explicitMaxWords} words -- do NOT exceed; the downstream TTS vendor has a per-video word limit.`
      : `5. Word budget: read the brief, decide which content type it is, and use the matching budget. Then hit it.
   - Marketing / ads / product promotion (selling or introducing a product, service, brand, drop): aim ~125 words, hard cap 175.
   - Narrative / personal story / memoir / scene-based fiction (character, situation, feeling, moment; viewer is meant to feel or picture it): aim ~225 words, hard cap 300.
   - Explainer / educational / how-to / case study (showing how something works, why something happens, or how to do something): aim ~200 words, hard cap 275.
   Decide on the type before writing the first sentence, then stay within that budget's hard cap. Do NOT exceed ${ABSOLUTE_MAX_WORDS} words under any circumstance -- this is the downstream TTS vendor's per-video word limit.`

  return `You are a short-form video scriptwriter.

SCRIPT DETECTION -- handle FIRST:

If the brief contains narrative text that reads as the video itself (not instructions about the video), that is the user's script.

- Script only -> preserve exactly. No rewriting. Output the user's words verbatim. Strip only the wrapping label ("script:", "voiceover:", "transcript:", "narration:" or similar) and any non-spoken content per Rule 1.
- Prompt + script -> extract the narrative block and output it as the script. Preserve the script text exactly. No rewriting. Other instructions inform the video, not the script.
- Prompt only (brief / instructions, no narrative) -> normal generation below.

RULES:
1. Spoken words only. **No brackets of any kind.** No stage directions, camera movements, sound cues, music cues, scene headings, speaker tags, character names ("Narrator:", "VOICEOVER:", "ANNOUNCER:"), parentheticals ("(pause)", "(beat)"), SSML / break tags ("<break>"), ALL-CAPS shot labels, asterisks, or any other non-spoken metadata. Output strictly the words the speaker will say.
2. Only use facts from the brief and any grounded research. Never invent statistics, features, or claims.
3. Marketing and ads end with a CTA.
4. Adhere to the user's stated preferences from the brief.
${wordBudgetBlock}
6. The user chose the direction. Find an unexpected way in.

If the brief mentions a specific product, brand, or topic, use grounded research / training-data knowledge to get accurate details before writing. Do not invent product specs or claims that are not in the brief and not grounded.

OUTPUT: Return only the spoken-word script as plain text. No JSON. No markdown. No headers. No preamble. No questions. No requests for clarification. Strictly the words the speaker will say.

VIDEO BRIEF:
${rawInput}`
}

// ---------------------------------------------------------------------------
// Activity: Script generation (single generic prompt; the model self-selects
// the content type + word budget from the brief in the same call)
// ---------------------------------------------------------------------------

export async function generateV4Script(
  params: GenerateV4ScriptActivityParams,
): Promise<GenerateV4ScriptActivityResult> {
  const { hasUserLengthRequest, maxWords, projectId, rawInput, targetWords, userId } = params

  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      logger.info(
        `[long-take] V4 generating script ${formatLogFields({ hasUserLengthRequest, projectId })}`,
      )

      const generationPrompt = buildV4GenerationPrompt({
        rawInput,
        ...(hasUserLengthRequest
          ? { explicitMaxWords: maxWords, explicitTargetWords: targetWords }
          : {}),
      })

      const response = await JobContext.run({ projectId, userId }, async () =>
        completion({
          models: ['gpt-5.5', 'seed-2-0-pro-260328', 'gemini-3.8-flash'],
          enableSearch: true,
          prompt: generationPrompt,
          responseFormat: z.string(),
          task: 'long-take-v4-generate-script',
          temperature: V4_GEN_TEMPERATURE,
          timeout: 22_000,
        }),
      )

      const script = (response || '').trim()

      if (!script) {
        logger.warn(
          `[long-take] V4 generation returned empty script ${formatLogFields({ projectId })}`,
        )
      }

      return { script }
    }),
  )
}
