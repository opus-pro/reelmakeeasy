import {
  transformForcedAlignmentToSegments,
  transformTranscriptToSegments,
} from '@agent-lib/agents/story-loader/voice-tools/utils/common.util'
import {
  type ScriptWordTiming,
  timesCaptionsLocally,
  timeScriptWords,
  timeScriptWordsLocally,
} from '@agent-lib/agents/story-loader/voice-tools/utils/forced-alignment-transcription.util'
import { generateASRTranscription } from '@reelmakeeasy/common/asr/elevenlabs'
import type { TranscriptData } from '@shared/types/agent/transcript'

import { formatError, formatLogFields, logger } from './common'

/**
 * `scriptSource` says where `scriptText` came from. `asr` means a real
 * transcription of the audio, so it can be compared against the intended script.
 * `forced_alignment` means it was manufactured by aligning `alignmentText` (the
 * confirmed script, usually) to the waveform -- it echoes the input text back and
 * therefore carries NO independent evidence of what the audio says. Any
 * fidelity check must treat that as unverifiable rather than as a pass.
 *
 * Recovery times the script on this computer when it can (aligner, then Whisper), else with the
 * cloud aligner, and when those fail or the guard turns them down, from the script's
 * punctuation and the audio's pauses: it fails only when there is no script to time.
 * `audioDurationSeconds` is the ffprobe length of the audio, for that timing.
 */
export async function performAsrAndDeriveScript(
  localMp3Path: string,
  confirmedScript: string | undefined,
  projectId: string,
  audioDurationSeconds?: number,
): Promise<{
  scriptSource: 'asr' | 'forced_alignment'
  scriptText: string
  transcriptData: ReturnType<typeof transformTranscriptToSegments>
}> {
  let asrResult: Awaited<ReturnType<typeof generateASRTranscription>>
  try {
    asrResult = await generateASRTranscription(localMp3Path)
  } catch (error) {
    logger.warn(
      `[long-take] ASR transcription failed, attempting forced-alignment recovery ${formatLogFields(
        {
          projectId,
          err: formatError(error),
        },
      )}`,
    )
    const alignedTranscript = await tryRecoverTranscriptWithForcedAlignment({
      alignmentText: confirmedScript,
      durationSeconds: audioDurationSeconds,
      localAudioPath: localMp3Path,
      projectId,
    })
    if (alignedTranscript) {
      return {
        scriptSource: 'forced_alignment',
        scriptText: deriveScriptTextFromTranscript(alignedTranscript),
        transcriptData: alignedTranscript,
      }
    }
    throw error
  }
  let transcriptData = transformTranscriptToSegments(asrResult)
  let scriptText = deriveScriptTextFromTranscript(transcriptData)
  let scriptSource: 'asr' | 'forced_alignment' = 'asr'

  const alignmentText = confirmedScript?.trim() || scriptText || asrResult.text?.trim()
  if (transcriptData.segments.length === 0 && alignmentText) {
    const alignedTranscript = await tryRecoverTranscriptWithForcedAlignment({
      alignmentText,
      durationSeconds: audioDurationSeconds,
      language: transcriptData.language,
      localAudioPath: localMp3Path,
      projectId,
    })
    if (alignedTranscript) {
      transcriptData = alignedTranscript
      scriptText = deriveScriptTextFromTranscript(transcriptData)
      scriptSource = 'forced_alignment'
    }
  }

  return { scriptSource, scriptText, transcriptData }
}

/**
 * The script's own words timed on this computer, as a transcript, for audio known to say the
 * script (TTS audio that passed the fidelity check): the aligner, then Whisper, then the
 * punctuation + pause fallback (`timeScriptWordsLocally`). Null when captions aren't timed on
 * this computer or the local server fails, so the caller keeps its ASR transcript and nothing
 * is paid for.
 */
export async function retimeTranscriptOnScript(params: {
  durationSeconds?: number
  language?: string
  localAudioPath: string
  projectId: string
  script: string
}): Promise<null | TranscriptData> {
  const script = params.script.trim()
  if (!script || !(await timesCaptionsLocally())) {
    return null
  }
  const timing = await timeScriptWordsLocally({
    audioPath: params.localAudioPath,
    durationSeconds: params.durationSeconds,
    providerLabel: 'long-take',
    text: script,
  })
  return timing ? toTranscript(timing, params) : null
}

function deriveScriptTextFromTranscript(transcriptData: TranscriptData): string {
  return (transcriptData.segments || [])
    .map((segment) => segment.text)
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join(' ')
}

/** Timed script words as transcript segments, logging who timed them. Null without words. */
function toTranscript(
  timing: ScriptWordTiming,
  params: { language?: string; projectId: string },
): null | TranscriptData {
  if (timing.words.length === 0) {
    return null
  }
  const transcriptData = transformForcedAlignmentToSegments(
    { characters: [], words: timing.words },
    params.language,
  )
  logger.info(
    `[long-take] Timed the script on the audio ${formatLogFields({
      projectId: params.projectId,
      source: timing.source,
      fallbackMode: timing.fallbackMode,
      rejected: timing.rejected.map(({ issues, step }) => `${step}:${issues.join('+')}`).join(','),
      wordCount: timing.words.length,
      segmentCount: transcriptData.segments.length,
    })}`,
  )
  return transcriptData
}

async function tryRecoverTranscriptWithForcedAlignment(params: {
  alignmentText?: string
  durationSeconds?: number
  language?: string
  localAudioPath: string
  projectId: string
}): Promise<null | TranscriptData> {
  const alignmentText = params.alignmentText?.trim()
  if (!alignmentText) {
    return null
  }
  const timing = await timeScriptWords({
    audioPath: params.localAudioPath,
    durationSeconds: params.durationSeconds,
    providerLabel: 'long-take',
    text: alignmentText,
  })
  return toTranscript(timing, params)
}
