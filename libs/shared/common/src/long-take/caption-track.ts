import type { TranscriptData } from '@shared/types/agent/transcript'

import { transcriptToEditingScriptTextTrack } from '../adapters/caption/caption-to-editing-script-text-track'
import { STORY_LOADER_PATHS } from '../agent-v2/paths'
import type { CaptionTrack } from '../types/video-script'
import { ensureError } from '../utils/error-handler'

import type { RenderFinalLogger, RenderFinalStorage } from './render-final.types'

// Extracted verbatim from render-final.ts (which sits at the max-lines ceiling)
// so the render pipeline file stays within budget; re-exported there to keep
// the @reelmakeeasy/common/long-take/render-final import surface unchanged.

export async function buildCaptionTrackIfEnabled(input: {
  enableCaption?: boolean | null
  logger: RenderFinalLogger
  /**
   * Never skip the captions while they are on (a loop short): a transcript that is missing,
   * can't be read or has no timed words fails the render, saying how to fix it.
   */
  required?: boolean
  /**
   * Each transcript segment is one caption, shown for its own window (a loop's chunks), also
   * in a transcript written before transcripts said so.
   */
  segmentWindows?: boolean
  storage: RenderFinalStorage
}): Promise<CaptionTrack | undefined> {
  const { enableCaption, logger, required, segmentWindows, storage } = input
  // The prompt-box caption toggle (gated by enable_sm_editor_v2 in the V2 UI)
  // is the single source of truth. Projects that predate the toggle have
  // enableCaption=null and keep the legacy default of rendering captions.
  if (enableCaption === false) {
    return undefined
  }

  const where = STORY_LOADER_PATHS.transformedTranscriptPath
  let problem: string
  try {
    const transcript = await storage.readJsonFile<TranscriptData>(where)
    if (hasRenderableTranscriptWords(transcript)) {
      return transcriptToEditingScriptTextTrack(
        segmentWindows ? { ...transcript, captionWindows: 'segment' } : transcript,
      )
    }
    problem = 'have no timed words'
    if (!required) {
      logger.info('[long-take] Caption track skipped - transcript has no renderable words')
    }
  } catch (error) {
    problem = `can't be read (${formatError(error).message})`
    if (!required) {
      logger.warn(
        `[long-take] Caption track skipped — transcript not found ${formatLogFields({
          projectId: 'unknown',
          err: formatError(error),
        })}`,
      )
    }
  }
  if (required) {
    throw new Error(
      `The captions can't be drawn: their timings (${where}) ${problem}. Make the voice-over again with Try again, or turn the captions off.`,
    )
  }
  return undefined
}

function formatError(error: unknown): { message: string; name: string; stack?: string } {
  const err = ensureError(error)
  return { name: err.name, message: err.message, stack: err.stack }
}

function formatLogFields(fields: Record<string, unknown>): string {
  try {
    return JSON.stringify(fields)
  } catch {
    return String(fields)
  }
}

function hasRenderableTranscriptWords(transcript: TranscriptData): boolean {
  return transcript.segments.some((section) =>
    section.words.some(
      (word) =>
        Boolean(word.word?.trim()) &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end > word.start,
    ),
  )
}
