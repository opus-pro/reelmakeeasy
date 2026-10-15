import { SpeechToTextChunkResponseModel } from '@reelmakeeasy/common/elevenlabs/client'
import { completion } from '@reelmakeeasy/common/llm'
import { logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { z } from 'zod'

import { validateAudioQuality } from './elevenlabs.util'
import { checkTranscriptFidelity } from './transcript-fidelity.util'

const ScriptValidationSchema = z.object({
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  hasTagLeakage: z.boolean(),
  issues: z.array(z.string()),
  isValid: z.boolean(),
})

export async function validateAudioQualityWithScript(
  asrResult: SpeechToTextChunkResponseModel,
  originalScript: string,
  ttsInputText?: string,
  useRelaxedLlmTtsQualityCheck = false,
): Promise<{ explanation: string; hasTagLeakage: boolean; issues: string[]; isValid: boolean }> {
  let audioQualityIssues: string[] = []
  if (asrResult.languageCode === 'eng') {
    const basicAudioValid = validateAudioQuality(asrResult)
    if (!basicAudioValid.isValid) {
      audioQualityIssues = basicAudioValid.issues
    }
  }

  const scriptValidation = await validateScriptAccuracy(
    originalScript,
    asrResult.text || '',
    ttsInputText,
    useRelaxedLlmTtsQualityCheck,
  )

  return {
    explanation: scriptValidation.explanation,
    hasTagLeakage: scriptValidation.hasTagLeakage,
    issues: [...audioQualityIssues, ...scriptValidation.issues],
    isValid: audioQualityIssues.length === 0 && scriptValidation.isValid,
  }
}

export async function validateScriptAccuracy(
  originalScript: string,
  asrTranscript: string,
  ttsInputText?: string,
  useRelaxedLlmTtsQualityCheck = false,
): Promise<{
  confidence: number
  explanation: string
  hasTagLeakage: boolean
  issues: string[]
  isValid: boolean
}> {
  // Deterministic fidelity gate runs for BOTH variants, before any LLM call: it
  // catches truncation AND inserted speech, and it cannot be waved through by a
  // flaky model response. Previously this only guarded the strict path, so the
  // relaxed variant had no deterministic protection at all.
  const fidelityCheck = checkTranscriptFidelity(originalScript, asrTranscript)
  if (!fidelityCheck.isValid) {
    return {
      confidence: 1,
      explanation: '',
      hasTagLeakage: false,
      issues: fidelityCheck.issues,
      isValid: false,
    }
  }

  if (useRelaxedLlmTtsQualityCheck) {
    return validateScriptAccuracyRelaxed(originalScript, asrTranscript, ttsInputText)
  }

  return validateScriptAccuracyStrictLegacy(originalScript, asrTranscript, ttsInputText)
}

async function validateScriptAccuracyRelaxed(
  originalScript: string,
  asrTranscript: string,
  ttsInputText?: string,
): Promise<{
  confidence: number
  explanation: string
  hasTagLeakage: boolean
  issues: string[]
  isValid: boolean
}> {
  try {
    const ttsSection =
      ttsInputText?.trim() && ttsInputText !== originalScript
        ? `\nACTUAL TTS INPUT (may contain emotion tags like [curious], [emphatic]):\n${ttsInputText}`
        : ''

    const prompt = `You are an expert audio quality validator for TTS outputs.

Your job is NOT to do word-by-word proofreading. Focus only on material user-facing problems.

FAIL the transcript (isValid: false) only when there is strong evidence of one of these:
- A full sentence or substantive clause from the original script is missing, cut off, or clearly not spoken
- The ending or trailing sentence is missing
- Inline direction tags or stage directions appear to have been spoken aloud (e.g. the TTS input had "[curious]" and the ASR contains the word "curious" as if spoken)
- A large chunk is reordered or replaced in a way that suggests missing content, not ordinary ASR noise

DO NOT fail for these:
- Isolated word substitutions, homophones, or ASR mishears
- Minor insertions or deletions of small words like "a", "the", "to", "and"
- Punctuation or capitalization differences
- Filler words like "um" or "uh"
- Number or symbol formatting differences when the spoken meaning is the same
- Proper noun spelling drift when the pronunciation is plausibly the same
- Small local ASR mistakes if the sentence is still clearly present

Set hasTagLeakage to true if any bracketed tag from the TTS input (e.g. [curious], [emphatic], [pause]) appears to have been spoken aloud in the ASR transcript.

If you are unsure whether something is just ASR noise, mark it VALID.

Respond with a JSON object:
{
  "isValid": boolean (false only for material issues),
  "hasTagLeakage": boolean,
  "issues": [list each material issue as a short string],
  "confidence": number (0-1),
  "explanation": "brief summary of findings"
}

ORIGINAL SCRIPT:
${originalScript}
${ttsSection}

ASR TRANSCRIPT:
${asrTranscript}
`

    const parsedResult = await completion({
      models: 'flash',
      responseFormat: ScriptValidationSchema,
      prompt,
      task: 'validate-script-accuracy',
      temperature: 0.1,
    })

    logger.info(
      `[TTS] LLM validation response - confidence: ${parsedResult.confidence}, hasTagLeakage: ${parsedResult.hasTagLeakage}, explanation: ${parsedResult.explanation}, issues: ${parsedResult.issues}, isValid: ${parsedResult.isValid}`,
    )

    const hasTagLeakage = parsedResult.hasTagLeakage || false

    return {
      confidence: parsedResult.confidence || 0.5,
      explanation: parsedResult.explanation || '',
      hasTagLeakage,
      issues: parsedResult.issues || [],
      isValid: !hasTagLeakage && (parsedResult.isValid || false),
    }
  } catch (error) {
    logger.error(`[TTS] Error in LLM-based script validation: ${error}`)
    // Fail CLOSED: a validator that could not run has not cleared this take.
    // Failing open here meant one flaky `flash` call silently promoted an
    // unvalidated voiceover to "valid" and skipped the retries that exist to
    // recover it. The caller retries and, if every attempt fails,
    // still ships the best available take -- so this costs re-renders, never a
    // hard failure.
    return {
      confidence: 0,
      explanation: '',
      hasTagLeakage: false,
      issues: [`LLM validation failed: ${ensureError(error).message}`],
      isValid: false,
    }
  }
}

async function validateScriptAccuracyStrictLegacy(
  originalScript: string,
  asrTranscript: string,
  ttsInputText?: string,
): Promise<{
  confidence: number
  explanation: string
  hasTagLeakage: boolean
  issues: string[]
  isValid: boolean
}> {
  // The deterministic fidelity gate already ran in validateScriptAccuracy.
  try {
    const ttsSection =
      ttsInputText?.trim() && ttsInputText !== originalScript
        ? `\nACTUAL TTS INPUT (may contain emotion tags like [curious], [emphatic]):\n${ttsInputText}`
        : ''

    const prompt = `You are an expert audio quality validator. Compare the original script with the ASR transcript and flag any word-level deviations - substitutions, dropped words, added words, or reorderings that are not in the original.

FLAG these as issues:
- Any word substituted for a different word, even if meaning seems similar (e.g. "product" vs "project", "build" vs "create")
- Words dropped from the original that are not present in the ASR
- Words added in the ASR that do not appear in the original (hallucinations)
- Sentences or clauses reordered relative to the original

DO NOT flag these as issues:
- Punctuation differences (commas, colons, dashes)
- Capitalization differences
- Filler words like "um" or "uh"
- Spelling variations of proper nouns where pronunciation is identical (e.g. "Jon" vs "John")
- Number formatting differences where the spoken form is identical (e.g. "$500" vs "five hundred dollars", "7" vs "seven")
- Parenthetical expansions or clarifications the ASR adds when vocalizing abbreviations or symbols (e.g. original "(NREM)" spoken as ", or NREM,")
- Phonetically near-identical word variants or common misspellings that sound the same when spoken (e.g. "pretension" vs "pretention", "centre" vs "center", "realise" vs "realize")

Set hasTagLeakage to true if any bracketed tag from the TTS input (e.g. [curious], [emphatic], [pause]) appears to have been spoken aloud in the ASR transcript.

Respond with a JSON object:
{
  "isValid": boolean (true only if no deviations found),
  "hasTagLeakage": boolean,
  "issues": [list each deviation as a short string, e.g. "word substitution: 'product' -> 'project'"],
  "confidence": number (0-1),
  "explanation": "brief summary of findings"
}

ORIGINAL SCRIPT:
${originalScript}
${ttsSection}

ASR TRANSCRIPT:
${asrTranscript}
`

    const parsedResult = await completion({
      models: 'flash',
      responseFormat: ScriptValidationSchema,
      prompt,
      task: 'validate-script-accuracy',
      temperature: 0.1,
    })

    logger.info(
      `[TTS] LLM validation response - confidence: ${parsedResult.confidence}, hasTagLeakage: ${parsedResult.hasTagLeakage}, explanation: ${parsedResult.explanation}, issues: ${parsedResult.issues}, isValid: ${parsedResult.isValid}`,
    )

    const hasTagLeakage = parsedResult.hasTagLeakage || false

    return {
      confidence: parsedResult.confidence || 0.5,
      explanation: parsedResult.explanation || '',
      hasTagLeakage,
      issues: parsedResult.issues || [],
      isValid: !hasTagLeakage && (parsedResult.isValid || false),
    }
  } catch (error) {
    logger.error(`[TTS] Error in LLM-based script validation: ${error}`)
    // Fail CLOSED: a validator that could not run has not cleared this take.
    // Failing open here meant one flaky `flash` call silently promoted an
    // unvalidated voiceover to "valid" and skipped the retries that exist to
    // recover it. The caller retries and, if every attempt fails,
    // still ships the best available take -- so this costs re-renders, never a
    // hard failure.
    return {
      confidence: 0,
      explanation: '',
      hasTagLeakage: false,
      issues: [`LLM validation failed: ${ensureError(error).message}`],
      isValid: false,
    }
  }
}
