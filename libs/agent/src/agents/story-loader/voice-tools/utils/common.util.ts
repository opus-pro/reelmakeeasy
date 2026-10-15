import { existsSync, statSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  ForcedAlignmentResponseModel,
  SpeechToTextChunkResponseModel,
} from '@reelmakeeasy/common/elevenlabs/client'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { completion } from '@reelmakeeasy/common/llm'
import { logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { TranscriptData, TranscriptSegment } from '@shared/types/agent/transcript'
import ffmpeg from 'fluent-ffmpeg'
import pLimit from 'p-limit'
import { z } from 'zod'

// Volume normalization constants - standard broadcast values
const LOUDNORM_TARGET_I = -23 // Integrated loudness (LUFS) - broadcast standard
const LOUDNORM_TARGET_TP = -1 // True peak (dBTP) - prevents clipping
const OUTPUT_SAMPLE_RATE = 48000 // Common sample rate for compatibility

// Cross-platform null device
const NULL_SINK = process.platform === 'win32' ? 'NUL' : '/dev/null'

interface LoudnormMeasurements {
  input_i: string
  input_lra: string
  input_thresh: string
  input_tp: string
}

// Define response schema for the combined transcript correction and quality validation
const CombinedTranscriptResponseSchema = z.object({
  correctedTranscript: z.object({
    language: z.string(),
    segments: z.array(
      z.object({
        end: z.number(),
        start: z.number(),
        text: z.string(),
        words: z.array(
          z.object({
            end: z.number(),
            speaker: z.string().nullable(),
            start: z.number(),
            word: z.string(),
          }),
        ),
      }),
    ),
  }),
  qualityValidation: z.object({
    confidence: z.number().min(0).max(1),
    explanation: z.string(),
    issues: z.array(z.string()),
    isValid: z.boolean(),
  }),
})

export function applyLoudnorm(
  inputPath: string,
  outputPath: string,
  measurements: LoudnormMeasurements,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false

    const done =
      <T>(fn: (x: T) => void) =>
      (x: T) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        fn(x)
      }

    const onReject = done<Error>((e) => reject(e))
    const onResolve = done<void>(() => resolve())

    const cmd = ffmpeg(inputPath)
      .outputOptions(['-hide_banner', '-nostats', '-loglevel', 'error'])
      .audioFilters([
        `loudnorm=I=${LOUDNORM_TARGET_I}:TP=${LOUDNORM_TARGET_TP}:measured_I=${measurements.input_i}:measured_TP=${measurements.input_tp}:measured_LRA=${measurements.input_lra}:measured_thresh=${measurements.input_thresh}`,
        `aresample=${OUTPUT_SAMPLE_RATE}`,
      ])
      .once('end', () => {
        // Verify output file was created and has content
        if (!existsSync(outputPath)) {
          return onReject(new Error('Normalized audio file was not created'))
        }

        try {
          const stats = statSync(outputPath)
          if (stats.size === 0) {
            return onReject(new Error('Normalized audio file is empty'))
          }
        } catch {
          return onReject(new Error('Cannot verify normalized audio file'))
        }

        onResolve()
      })
      .once('error', (err: Error) => {
        onReject(new Error(`FFmpeg normalization failed: ${err.message}`))
      })
      .save(outputPath)

    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      // try graceful, then hard kill
      try {
        ;(cmd as unknown as { kill?: (signal: string) => void }).kill?.('SIGTERM')
      } catch {
        // Ignore kill errors
      }
      setTimeout(() => {
        try {
          ;(cmd as unknown as { kill?: (signal: string) => void }).kill?.('SIGKILL')
        } catch {
          // Ignore kill errors
        }
      }, 1500)
      onReject(new Error('Normalization timeout after 60 seconds'))
    }, 60000)
  })
}

// Max segments per single LLM correction call. Above this, the LLM
// reliably truncates the structured-JSON output -- a 10-min video at
// ~127 segments returned only 3 segments / 58 words, destroying the
// downstream shot-plan timing. 15 keeps each chunk's output JSON small
// enough that the LLM reproduces it verbatim with spelling corrections.
const CORRECTION_MAX_SEGMENTS_PER_CHUNK = 15

// Cap concurrent LLM correction requests. A 10-min video produces
// ~140 segments -> 10 chunks; running all 10 gemini calls in parallel
// blew up worker memory (each request streams ~15K-token prompt + zod
// parse buffer) and ran out of memory mid-correction. 5 keeps wall-time
// reasonable while bounding peak memory.
const CORRECTION_CHUNK_CONCURRENCY = 5

interface CorrectionResult {
  correctedTranscript: TranscriptData
  qualityValidation: QualityValidation
}

interface QualityValidation {
  confidence: number
  explanation: string
  issues: string[]
  isValid: boolean
}

interface SingleChunkCorrectionResult extends CorrectionResult {
  hasCorrections: boolean
}

/**
 * Combined transcript correction + TTS quality validation.
 *
 * For long transcripts the LLM cannot reliably reproduce 100+ segments
 * of structured JSON in a single output -- it truncates / merges /
 * silently drops segments. We split the transcript into
 * CORRECTION_MAX_SEGMENTS_PER_CHUNK-sized batches, send each to the LLM
 * with the FULL original script as spelling reference, then concatenate
 * the corrected chunks back in order. Quality-validation results are
 * aggregated (any chunk hallucination = whole transcript invalid;
 * confidence = min across chunks; issues unioned).
 */
export async function correctTranscriptAndValidateTTSQuality(
  transcriptData: TranscriptData,
  originalScript: string,
  debugDir: string,
  projectId?: string,
): Promise<SingleChunkCorrectionResult> {
  try {
    const originalText = transcriptData.segments.map((segment) => segment.text).join(' ')
    const segmentsCount = transcriptData.segments.length
    logger.info({
      msg: 'Starting combined transcript correction and quality validation',
      originalTextLength: originalText.length,
      segmentsCount,
      originalScriptLength: originalScript.length,
    })

    let parsedResult: CorrectionResult

    if (segmentsCount <= CORRECTION_MAX_SEGMENTS_PER_CHUNK) {
      const single = await runSingleChunkCorrection(transcriptData, originalScript)
      if (!single) {
        return buildUnexpectedStructureFallback(transcriptData)
      }
      // Same segment-count drift guard as the chunked path: if the LLM
      // collapses segments here (e.g. 12 in -> 4 out), the per-word
      // timeline gets crushed and downstream beat-sheet timing falls apart.
      const correctedSegs = single.correctedTranscript.segments
      const segmentCountMatches = correctedSegs.length === transcriptData.segments.length
      const wordCountsMatch =
        segmentCountMatches &&
        correctedSegs.every(
          (seg, i) => (seg.words?.length ?? 0) === (transcriptData.segments[i].words?.length ?? 0),
        )
      const textMatchesWords =
        wordCountsMatch && correctedSegs.every((seg) => transcriptSegmentTextMatchesWords(seg))
      if (!segmentCountMatches || !wordCountsMatch || !textMatchesWords) {
        logger.warn({
          msg: 'Single-chunk correction LLM merged/split segments; falling back to original',
          inputSegments: transcriptData.segments.length,
          outputSegments: correctedSegs.length,
          textMatchesWords,
        })
        return buildUnexpectedStructureFallback(transcriptData)
      }
      parsedResult = {
        ...single,
        correctedTranscript: {
          ...transcriptData,
          segments: takeCorrectedText(transcriptData.segments, correctedSegs),
        },
      }
    } else {
      const chunked = await runChunkedCorrection(transcriptData, originalScript)
      if (!chunked) {
        return buildUnexpectedStructureFallback(transcriptData)
      }
      parsedResult = chunked
      logger.info({
        msg: 'Chunked transcript correction merged',
        originalSegments: segmentsCount,
        mergedSegments: parsedResult.correctedTranscript.segments.length,
      })
    }

    if (!parsedResult.correctedTranscript || !parsedResult.qualityValidation) {
      logger.warn({ msg: 'LLM returned unexpected structure, using original', parsedResult })
      return buildUnexpectedStructureFallback(transcriptData)
    }

    const correctedText = parsedResult.correctedTranscript.segments
      .map((segment: { text: string }) => segment.text)
      .join(' ')
    const hasChanges = originalText !== correctedText

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const originalFile = path.join(debugDir, `original-${timestamp}.json`)
    const correctedFile = path.join(debugDir, `corrected-${timestamp}.json`)
    const validationFile = path.join(debugDir, `validation-${timestamp}.json`)

    if (projectId) {
      const storage = await createStorage(projectId)
      await storage.writeJsonFile(originalFile, transcriptData)
      await storage.writeJsonFile(correctedFile, parsedResult.correctedTranscript)
      await storage.writeJsonFile(validationFile, parsedResult.qualityValidation)
    } else {
      await writeFile(originalFile, JSON.stringify(transcriptData, null, 2))
      await writeFile(correctedFile, JSON.stringify(parsedResult.correctedTranscript, null, 2))
      await writeFile(validationFile, JSON.stringify(parsedResult.qualityValidation, null, 2))
    }

    logger.info({
      msg: 'Combined transcript correction and quality validation completed',
      originalSegmentsCount: segmentsCount,
      correctedSegmentsCount: parsedResult.correctedTranscript.segments.length,
      originalFile,
      correctedFile,
      validationFile,
      hasChanges,
      qualityValidation: parsedResult.qualityValidation,
    })

    return {
      correctedTranscript: parsedResult.correctedTranscript,
      hasCorrections: hasChanges,
      qualityValidation: parsedResult.qualityValidation,
    }
  } catch (error) {
    logger.error({
      msg: 'Error in combined transcript correction and quality validation',
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      correctedTranscript: transcriptData,
      hasCorrections: false,
      qualityValidation: {
        confidence: 0,
        issues: [`Processing failed: ${error instanceof Error ? error.message : String(error)}`],
        isValid: true,
        explanation: 'Fallback to original transcript due to processing error',
      },
    }
  }
}

function buildUnexpectedStructureFallback(
  transcriptData: TranscriptData,
): SingleChunkCorrectionResult {
  return {
    correctedTranscript: transcriptData,
    hasCorrections: false,
    qualityValidation: {
      confidence: 0,
      issues: ['LLM returned unexpected structure'],
      isValid: true,
      explanation: 'Fallback to original transcript due to LLM response structure issues',
    },
  }
}

/**
 * Parse the JSON block that ffmpeg's loudnorm analysis pass writes to stderr.
 *
 * Reads the LAST brace pair instead of regex-matching. A greedy
 * `\{[\s\S]*\}` spans the first `{` to the last `}`, so a stderr buffer
 * carrying more than one brace block collapses into a single `{...}\n{...}`
 * string; JSON.parse then completes the first object, hits the next `{`, and
 * throws "Unexpected non-whitespace character after JSON". The
 * loudnorm block is flat, so the last brace pair is exactly it.
 *
 * Mirrors `parseLoudnormStats` in `@reelmakeeasy/common/utils/generate-preview-video`
 * and `parseLoudnormIntegratedLufs` in `@reelmakeeasy/common/long-take/bgm-mix`, which
 * already read the buffer this way.
 */
export function parseLoudnormMeasurements(stderr: string): LoudnormMeasurements {
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('Could not parse loudnorm measurements from FFmpeg output')
  }

  let measurements: LoudnormMeasurements
  try {
    measurements = JSON.parse(stderr.slice(start, end + 1)) as LoudnormMeasurements
  } catch (e) {
    throw new Error(`Failed to parse loudnorm JSON: ${ensureError(e).message}`)
  }

  if (
    !measurements.input_i ||
    !measurements.input_tp ||
    !measurements.input_lra ||
    !measurements.input_thresh
  ) {
    throw new Error('Incomplete loudnorm measurements received')
  }

  return measurements
}

/**
 * Measure a file's loudness with an ffmpeg loudnorm analysis pass, for the
 * linear second pass in `applyLoudnorm`.
 */
export function measureLoudnorm(inputPath: string): Promise<LoudnormMeasurements> {
  return new Promise((resolve, reject) => {
    let settled = false
    let buf = ''

    const done =
      <T>(
        fn: (x: T) => void, // eslint-disable-next-line sonarjs/no-identical-functions
      ) =>
      (x: T) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        fn(x)
      }

    const onReject = done<Error>((e) => reject(e))
    const onResolve = done<LoudnormMeasurements>((m) => resolve(m))

    const cmd = ffmpeg(inputPath)
      .outputOptions(['-hide_banner', '-nostats'])
      .audioFilters(`loudnorm=I=${LOUDNORM_TARGET_I}:TP=${LOUDNORM_TARGET_TP}:print_format=json`)
      .format('null')
      .on('stderr', (line: string) => {
        buf += `${line}\n`
      })
      .once('end', () => {
        try {
          onResolve(parseLoudnormMeasurements(buf))
        } catch (e) {
          onReject(ensureError(e))
        }
      })
      .once('error', (err: Error) => {
        onReject(new Error(`FFmpeg analysis failed: ${err.message}`))
      })
      .saveToFile(NULL_SINK)

    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      // try graceful, then hard kill
      try {
        ;(cmd as unknown as { kill?: (signal: string) => void }).kill?.('SIGTERM')
      } catch {
        // Ignore kill errors
      }
      setTimeout(() => {
        try {
          ;(cmd as unknown as { kill?: (signal: string) => void }).kill?.('SIGKILL')
        } catch {
          // Ignore kill errors
        }
      }, 1500)
      onReject(new Error('Analysis timeout after 30 seconds'))
    }, 30_000)
  })
}

function chunkTranscriptSegments(
  segments: TranscriptSegment[],
  maxPerChunk: number,
): TranscriptSegment[][] {
  if (segments.length <= maxPerChunk) {
    return [segments]
  }
  const chunks: TranscriptSegment[][] = []
  for (let i = 0; i < segments.length; i += maxPerChunk) {
    chunks.push(segments.slice(i, i + maxPerChunk))
  }
  return chunks
}

function expandContractionToken(token: string): string[] {
  const normalized = token
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\u2019/g, "'")

  // Keep this map focused on common ASR/script contraction disagreements.
  // Unmapped forms fall back conservatively to avoid corrupting word timelines.
  const expansions: Record<string, string[]> = {
    "there's": ['there', 'is'],
    "that's": ['that', 'is'],
    "what's": ['what', 'is'],
    "who's": ['who', 'is'],
    "he's": ['he', 'is'],
    "she's": ['she', 'is'],
    "it's": ['it', 'is'],
    "here's": ['here', 'is'],
    "where's": ['where', 'is'],
    "when's": ['when', 'is'],
    "why's": ['why', 'is'],
    "how's": ['how', 'is'],
    "let's": ['let', 'us'],
    "i'm": ['i', 'am'],
    "you're": ['you', 'are'],
    "we're": ['we', 'are'],
    "they're": ['they', 'are'],
    "i've": ['i', 'have'],
    "you've": ['you', 'have'],
    "we've": ['we', 'have'],
    "they've": ['they', 'have'],
    "i'd": ['i', 'would'],
    "you'd": ['you', 'would'],
    "he'd": ['he', 'would'],
    "she'd": ['she', 'would'],
    "we'd": ['we', 'would'],
    "they'd": ['they', 'would'],
    "i'll": ['i', 'will'],
    "you'll": ['you', 'will'],
    "he'll": ['he', 'will'],
    "she'll": ['she', 'will'],
    "we'll": ['we', 'will'],
    "they'll": ['they', 'will'],
    "can't": ['can', 'not'],
    "won't": ['will', 'not'],
    "don't": ['do', 'not'],
    "doesn't": ['does', 'not'],
    "didn't": ['did', 'not'],
    "isn't": ['is', 'not'],
    "aren't": ['are', 'not'],
    "wasn't": ['was', 'not'],
    "weren't": ['were', 'not'],
    "hasn't": ['has', 'not'],
    "haven't": ['have', 'not'],
    "hadn't": ['had', 'not'],
    "shouldn't": ['should', 'not'],
    "couldn't": ['could', 'not'],
    "wouldn't": ['would', 'not'],
    "mustn't": ['must', 'not'],
    "needn't": ['need', 'not'],
  }

  return expansions[normalized] ?? [token]
}

function normalizeTranscriptToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

async function runChunkedCorrection(
  transcriptData: TranscriptData,
  originalScript: string,
): Promise<CorrectionResult | null> {
  const chunks = chunkTranscriptSegments(transcriptData.segments, CORRECTION_MAX_SEGMENTS_PER_CHUNK)
  logger.info({
    msg: 'Running chunked transcript correction',
    totalSegments: transcriptData.segments.length,
    chunkCount: chunks.length,
    maxPerChunk: CORRECTION_MAX_SEGMENTS_PER_CHUNK,
  })

  const limit = pLimit(CORRECTION_CHUNK_CONCURRENCY)
  const chunkResults = await Promise.all(
    chunks.map((segs, idx) =>
      limit(() => {
        const chunkTranscript: TranscriptData = { ...transcriptData, segments: segs }
        return runSingleChunkCorrection(chunkTranscript, originalScript).catch((err) => {
          logger.warn({
            msg: 'Chunked correction LLM call failed; using raw chunk',
            chunkIndex: idx,
            error: err instanceof Error ? err.message : String(err),
          })
          return null
        })
      }),
    ),
  )

  const mergedSegments: TranscriptSegment[] = []
  const aggregatedIssues: string[] = []
  let minConfidence = 1
  let anyInvalid = false
  let anyFailedChunk = false

  chunkResults.forEach((result, idx) => {
    const fallbackChunk = chunks[idx]
    if (!result || !result.correctedTranscript) {
      // Chunk LLM failed -- fall back to the raw ASR segments for THIS
      // chunk so the merged transcript still covers the full timeline.
      mergedSegments.push(...fallbackChunk)
      aggregatedIssues.push(`Chunk ${idx + 1}: correction LLM failed; using raw ASR`)
      minConfidence = Math.min(minConfidence, 0.5)
      anyFailedChunk = true
      return
    }
    // Segment-count drift guard: gemini-2.5-pro tends to merge adjacent
    // segments (e.g. 15 in -> 3 out) when correcting a chunk, which silently
    // destroys the per-word timeline downstream beat-sheet timing depends on.
    // Treat any drift in segment count OR per-segment word count as a
    // correction failure and fall back to the raw ASR chunk.
    const correctedSegs = result.correctedTranscript.segments
    const segmentCountMatches = correctedSegs.length === fallbackChunk.length
    const wordCountsMatch =
      segmentCountMatches &&
      correctedSegs.every(
        (seg, i) => (seg.words?.length ?? 0) === (fallbackChunk[i].words?.length ?? 0),
      )
    const textMatchesWords =
      wordCountsMatch && correctedSegs.every((seg) => transcriptSegmentTextMatchesWords(seg))
    if (!segmentCountMatches || !wordCountsMatch || !textMatchesWords) {
      logger.warn({
        msg: 'Chunked correction LLM merged/split segments; using raw chunk',
        chunkIndex: idx,
        inputSegments: fallbackChunk.length,
        outputSegments: correctedSegs.length,
        inputWords: fallbackChunk.reduce((a, s) => a + (s.words?.length ?? 0), 0),
        outputWords: correctedSegs.reduce((a, s) => a + (s.words?.length ?? 0), 0),
        textMatchesWords,
      })
      mergedSegments.push(...fallbackChunk)
      aggregatedIssues.push(`Chunk ${idx + 1}: correction merged/split segments; using raw ASR`)
      minConfidence = Math.min(minConfidence, 0.5)
      anyFailedChunk = true
      return
    }
    mergedSegments.push(...takeCorrectedText(fallbackChunk, correctedSegs))
    aggregatedIssues.push(...result.qualityValidation.issues)
    if (!result.qualityValidation.isValid) {
      anyInvalid = true
    }
    minConfidence = Math.min(minConfidence, result.qualityValidation.confidence)
  })

  return {
    correctedTranscript: {
      language: transcriptData.language,
      segments: mergedSegments,
    },
    qualityValidation: {
      isValid: !anyInvalid,
      issues: aggregatedIssues,
      confidence: minConfidence,
      explanation: anyFailedChunk
        ? `Chunked correction across ${chunks.length} batches; ${aggregatedIssues.length} issue(s) reported, some chunks fell back to raw ASR.`
        : `Chunked correction across ${chunks.length} batches; ${aggregatedIssues.length} issue(s) reported.`,
    },
  }
}

async function runSingleChunkCorrection(
  transcriptData: TranscriptData,
  originalScript: string,
): Promise<null | z.infer<typeof CombinedTranscriptResponseSchema>> {
  const prompt = `You are performing two tasks: correcting a transcript JSON and validating audio quality by comparing with the original script.

ORIGINAL SCRIPT:
${originalScript}

TRANSCRIPT JSON TO CORRECT:
${JSON.stringify(transcriptData, null, 2)}

TASK 1 - TRANSCRIPT CORRECTION:
1. Focus ONLY on correcting spelling mistakes that differ from the original script
2. IGNORE extra words that may have been added by TTS (these are acceptable)
3. IGNORE minor word substitutions that preserve meaning, EXCEPT proper nouns and brand names (see rule 5)
4. IGNORE punctuation and capitalization differences
5. Correct clear spelling errors (e.g., "zibouboule" -> "zibubu"). ALWAYS restore proper nouns and brand names to the exact spelling used in the original script when the ASR word sounds like the script's word, even if the ASR word is a valid English word (e.g., ASR wrote "Meridian" but the original script says "Merydian" -> correct it to "Merydian"). Respell existing words in place; NEVER merge, split, add, or remove words to do this
6. Keep all timing information (start, end) exactly the same
7. Keep all speaker information exactly the same
8. Only change the "word" field and corresponding "text" field when correcting spelling
9. **CRITICAL: Do NOT merge, split, reorder, or drop segments.** The output \`segments\` array MUST have EXACTLY the same length as the input \`segments\` array, and each output segment[i] MUST correspond 1-to-1 to input segment[i]. Same with \`words\` inside each segment: do NOT add, remove, merge, or reorder words; only edit the spelling of existing words in place.

TASK 2 - QUALITY VALIDATION:
Compare the corrected transcript with the original script to detect ONLY significant ASR hallucinations - words or phrases that the ASR model completely invented that are not present in the original script.

CRITICAL: You should only flag issues if the transcript contains hallucinations (completely invented words/phrases) that meaningfully change the content or add new information not present in the original script.

DO NOT flag these as issues:
- Grammatical errors, spelling mistakes, or poor wording that exist in the ORIGINAL script
- Minor word substitutions that preserve meaning (e.g., "five hundred dollars" vs "$500")
- Punctuation differences
- Capitalization differences
- Filler words like "um", "uh" that are natural in speech
- Minor spelling variations that don't change meaning
- Awkward phrasing that might exist in the original script
- Adding 1-2 minor words that don't change the core meaning
- Proper noun or brand name spelling drift when it sounds like the script's word (e.g., "Meridian" vs "Merydian"): restore the script's spelling in TASK 1 per rule 5 instead of flagging it here; it is a spelling correction, not a hallucination
- Single word spelling mistakes that don't change meaning (e.g., "recieve" vs "receive")

Focus on: Does the transcript contain hallucinations that meaningfully change or add substantial content not in the original script?

Return a JSON object with this exact structure:
{
  "correctedTranscript": {
    "language": "string",
    "segments": [
      {
        "end": "number",
        "start": "number",
        "text": "string",
        "words": [
          {
            "end": "number",
            "speaker": "string|null",
            "start": "number",
            "word": "string"
          }
        ]
      }
    ]
  },
  "qualityValidation": {
    "isValid": "boolean",
    "issues": ["array of significant ASR hallucination issues found"],
    "confidence": "number (0-1, how confident you are in this assessment)",
    "explanation": "brief explanation focusing only on significant ASR hallucinations"
  }
}`

  const result = await completion({
    models: ['gemini-2.5-pro', 'gpt-5'],
    responseFormat: CombinedTranscriptResponseSchema,
    prompt,
    task: 'correct-transcript-and-validate-quality',
    temperature: 0.1,
  })

  if (!result?.correctedTranscript || !result?.qualityValidation) {
    return null
  }
  return result
}

/**
 * The correction LLM may only respell words, but it echoes the whole
 * transcript back and sometimes rewrites a time on the way: a stored run
 * returned "for" (98.82-98.92 s) ending at 8.92 s, so the word ended before
 * it started. Take only the text (segment `text`, word `word`) from the
 * corrected segments and keep every time and speaker from the ASR segments.
 * Callers first check that segment and per-segment word counts match.
 */
function takeCorrectedText(
  asrSegments: TranscriptSegment[],
  correctedSegments: TranscriptSegment[],
): TranscriptSegment[] {
  return asrSegments.map((segment, i) => {
    const corrected = correctedSegments[i]
    return {
      ...segment,
      text: corrected.text,
      words: segment.words.map((word, j) => ({ ...word, word: corrected.words[j].word })),
    }
  })
}

function tokenizeTranscriptText(text: string): string[] {
  return text
    .split(/\s+/)
    .flatMap(expandContractionToken)
    .map(normalizeTranscriptToken)
    .filter(Boolean)
}

function transcriptSegmentTextMatchesWords(segment: TranscriptSegment): boolean {
  const textTokens = tokenizeTranscriptText(segment.text)
  const wordTokens = (segment.words || []).flatMap((word) => tokenizeTranscriptText(word.word))

  if (textTokens.length !== wordTokens.length) {
    return false
  }

  return textTokens.every((token, index) => token === wordTokens[index])
}

/**
 * Helper to process a file locally using Storage abstraction.
 * Downloads the file from Storage to a temp path, processes it, and optionally uploads it back.
 *
 * @param projectId - Project ID to create Storage
 * @param filePath - Relative path in storage
 * @param processor - Function that takes a local temp file path and returns a result
 * @returns Result of the processor function
 */
export async function processWithLocalFile<T>(
  projectId: string,
  filePath: string,
  processor: (localPath: string) => Promise<T>,
): Promise<T> {
  const storage = await createStorage(projectId)
  // Use os.tmpdir() for creating a safe temporary file
  const tempDir = os.tmpdir()
  const tempFileName = `reelmakeeasy_proc_${Date.now()}_${Math.random().toString(36).slice(7)}_${path.basename(filePath)}`
  const localTempPath = path.join(tempDir, tempFileName)

  try {
    // Download file from storage to local temp path
    await storage.downloadFile(filePath, localTempPath)

    // Run processor on the local file
    return await processor(localTempPath)
  } finally {
    // Always cleanup the temp file
    try {
      if (existsSync(localTempPath)) {
        await unlink(localTempPath)
      }
    } catch (cleanupError) {
      logger.warn(`Failed to cleanup temp file ${localTempPath}: ${cleanupError}`)
    }
  }
}

/**
 * Applies two-pass loudness normalization using standard broadcast values
 * Uses -23 LUFS integrated loudness and -1 dBTP true peak
 */
export async function normalizeAudioVolume(
  projectId: string,
  filePath: string,
): Promise<{ message: string; success: boolean }> {
  const storage = await createStorage(projectId)
  return processWithLocalFile(projectId, filePath, async (localPath) => {
    try {
      const tempOutputPath = localPath.replace(/\.([^.]+)$/, '_normalized.$1')

      try {
        // First pass: measure loudness
        const measurements = await measureLoudnorm(localPath)

        // Second pass: apply normalization
        await applyLoudnorm(localPath, tempOutputPath, measurements)

        // Verify result
        const normalizedBuffer = await readFile(tempOutputPath)
        if (normalizedBuffer.length === 0) {
          throw new Error('Normalized audio buffer is empty')
        }

        // Upload normalized file back to storage (replacing original)
        await storage.uploadFile(tempOutputPath, filePath)

        return {
          success: true,
          message: 'Audio normalized to -23 LUFS broadcast standard',
        }
      } finally {
        // Cleanup intermediate file
        if (existsSync(tempOutputPath)) {
          try {
            await unlink(tempOutputPath)
          } catch (e) {
            logger.error(`existsSync(tempOutputPath) failed: ${e}`)
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`Audio normalization failed: ${errorMessage}`)

      return {
        success: false,
        message: errorMessage,
      }
    }
  })
}

/**
 * Transform ElevenLabs Speech-to-Text API response to our transcription format (segmented).
 * Groups words into segments, splitting on punctuation or after a word count limit.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function transformTranscriptToSegments(
  elevenlabsResponse: SpeechToTextChunkResponseModel,
): TranscriptData {
  const punctuation = new Set(['!', '.', '?'])
  const segments: TranscriptSegment[] = []
  let currentSegment: TranscriptSegment = {
    end: 0,
    start: 0,
    text: '',
    words: [],
  }

  for (const word of elevenlabsResponse.words) {
    if (word.type === 'word' && word.start != null && word.end != null) {
      const wordInfo = {
        end: word.end,
        speaker: word.speakerId ?? null,
        start: word.start,
        word: word.text,
      }
      if (currentSegment.words.length === 0 && word.start != null) {
        currentSegment.start = word.start
      }
      currentSegment.words.push(wordInfo)
      currentSegment.text += (currentSegment.text ? ' ' : '') + word.text

      // Split segment on punctuation in our punctuation set
      if (word.text.length > 0 && punctuation.has(word.text[word.text.length - 1])) {
        currentSegment.end = word.end
        if (currentSegment.start != null && currentSegment.end != null) {
          segments.push(currentSegment)
        }
        currentSegment = {
          end: 0,
          start: 0,
          text: '',
          words: [],
        }
      }
    }
  }

  if (currentSegment.words.length > 0) {
    currentSegment.end = currentSegment.words[currentSegment.words.length - 1].end
    if (currentSegment.start != null && currentSegment.end != null) {
      segments.push(currentSegment)
    }
  }

  return {
    language: elevenlabsResponse.languageCode,
    segments,
  }
}

/**
 * Transform ElevenLabs Forced Alignment API response to our transcription format.
 * Forced alignment returns word-level timestamps from a known text, useful when
 * standard ASR fails to produce word timestamps (e.g. music/singing audio).
 */
export function transformForcedAlignmentToSegments(
  alignmentResponse: ForcedAlignmentResponseModel,
  language?: string,
): TranscriptData {
  const punctuation = new Set(['!', '.', '?'])
  const segments: TranscriptSegment[] = []
  let currentSegment: TranscriptSegment = {
    end: 0,
    start: 0,
    text: '',
    words: [],
  }

  for (const word of alignmentResponse.words) {
    const wordInfo = {
      end: word.end,
      speaker: null,
      start: word.start,
      word: word.text,
    }
    if (currentSegment.words.length === 0) {
      currentSegment.start = word.start
    }
    currentSegment.words.push(wordInfo)
    currentSegment.text += (currentSegment.text ? ' ' : '') + word.text

    if (word.text.length > 0 && punctuation.has(word.text[word.text.length - 1])) {
      currentSegment.end = word.end
      segments.push(currentSegment)
      currentSegment = { end: 0, start: 0, text: '', words: [] }
    }
  }

  if (currentSegment.words.length > 0) {
    currentSegment.end = currentSegment.words[currentSegment.words.length - 1].end
    segments.push(currentSegment)
  }

  return { language: language || 'eng', segments }
}
