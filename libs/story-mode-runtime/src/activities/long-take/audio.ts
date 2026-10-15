import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

import { runTtsAndAsrOrchestration } from '@agent-lib/agents/story-loader/voice-tools/utilities/tts-asr'
import { correctTranscriptAndValidateTTSQuality } from '@agent-lib/agents/story-loader/voice-tools/utils/common.util'
import { checkTranscriptFidelity } from '@agent-lib/agents/story-loader/voice-tools/utils/transcript-fidelity.util'
import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import {
  isCacheEnabled,
  saveCachedBinaryToFile,
  tryReadBinaryMeta,
  tryWriteBinary,
} from '@reelmakeeasy/common/llm/llm-cache'
import { EXPANDED_STORY_MODE_LIMITS } from '@reelmakeeasy/common/story-mode/user-limits'
import { defaultVoiceId } from '@reelmakeeasy/common/tts/default-voice'
import { transcodeAudioToM4a } from '@reelmakeeasy/common/utils/transcode-audio'
import type { TranscriptData } from '@shared/types/agent/transcript'

import type {
  CorrectLongTakeTranscriptActivityParams,
  CorrectLongTakeTranscriptActivityResult,
  GenerateLongTakeScriptActivityParams,
  GenerateLongTakeScriptActivityResult,
  GenerateLongTakeVoiceoverActivityParams,
  GenerateLongTakeVoiceoverActivityResult,
} from '../../workflows/long-take/types'

import { maybeSpeedUpStoryModeVoiceover, type StoryModeAudioSpeedupOutcome } from './audio-speedup'
import { performAsrAndDeriveScript, retimeTranscriptOnScript } from './audio-transcript-recovery'
import {
  downloadAssetToLocal,
  formatError,
  formatLogFields,
  getActivityExecutionLogFields,
  getVideoDurationSeconds,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage, getLongTakeKeyframeGlobalContext } from './storage'
import { isLongTakeUserVoiceCloneVoiceId } from './voice-clone'
import { isVoiceoverControlFlowError, throwTtsProviderFailure } from './voiceover-failure'
import { isStoreUri } from '@reelmakeeasy/common/storage/stored-files'

export interface RunAsrForUploadedAudioParams {
  audioPath: string
  confirmedScript?: string
  projectId: string
  userEmail?: string
  userId: string
}

export interface RunAsrForUploadedAudioResult {
  audioDurationSeconds?: number
  scriptText: string
  transcriptPath: string
}

export async function generateLongTakeScript(
  params: GenerateLongTakeScriptActivityParams,
): Promise<GenerateLongTakeScriptActivityResult> {
  const { projectId, script, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const rawInput = script?.trim()
      if (!rawInput) {
        throw new Error('Script is required')
      }

      const startedAt = Date.now()
      logger.info(
        `[long-take] Script extraction started ${formatLogFields({
          projectId,
          userId,
          rawLength: rawInput.length,
        })}`,
      )
      try {
        const storage = createLongTakeStorage(projectId)

        await storage.ensureDir('story_loader')
        await storage.ensureDir('long_take')

        const scriptPath = STORY_LOADER_PATHS.scriptTxtPath
        await storage.writeFile(scriptPath, rawInput)

        logger.info(
          `[long-take] Script saved ${formatLogFields({
            projectId,
            userId,
            scriptPath,
            scriptLength: rawInput.length,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return { scriptPath }
      } catch (error) {
        logger.error(
          `[long-take] Script extraction failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        throw error
      }
    }),
  )
}

export async function generateLongTakeVoiceover(
  params: GenerateLongTakeVoiceoverActivityParams,
): Promise<GenerateLongTakeVoiceoverActivityResult> {
  const {
    audioPath,
    audioSource,
    confirmedScript,
    orgId,
    projectId,
    skipCorrection,
    userEmail,
    userId,
    voiceId,
  } = params
  return withLongTakeContext({ projectId, userId, userEmail }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const activityLogFields = getActivityExecutionLogFields()
      // Set when the preview-handoff audio failed the fidelity gate and we fell
      // through to fresh TTS, so the failure log below names the path we were
      // actually on rather than the one we abandoned.
      let regeneratingAfterFidelityRejection = false
      // The effective TTS provider, reported by the router before it synthesizes.
      // Stays undefined when the failure precedes provider resolution.
      let resolvedTtsProvider: string | undefined

      try {
        if (audioPath) {
          logger.info(
            `[long-take] Voiceover from uploaded audio started ${formatLogFields({
              ...activityLogFields,
              source: 'uploaded_audio',
              stage: 'voiceover',
              projectId,
              userId,
              audioPath,
            })}`,
          )
          const result = await processLongTakeUploadedAudio({
            audioPath,
            audioSource,
            confirmedScript,
            projectId,
          })
          if (result) {
            logger.info(
              `[long-take] Voiceover from uploaded audio completed ${formatLogFields({
                ...activityLogFields,
                source: 'uploaded_audio',
                stage: 'voiceover',
                projectId,
                userId,
                transcriptPath: result.transcriptPath,
                voiceOverPath: result.voiceOverPath,
                audioDurationSeconds: result.audioDurationSeconds,
                durationMs: Date.now() - startedAt,
              })}`,
            )
            return {
              ...result,
              fasterTtsApplied: false,
              fasterTtsCohort: 'not_evaluated',
              fasterTtsEvaluated: false,
              fasterTtsSkipReason: 'uploaded-audio',
            }
          }
          // The handed-off preview take failed the fidelity gate and nothing was
          // published except script.txt. Fall through to the TTS/ASR path below,
          // which regenerates from that script behind its own gate + retries.
          regeneratingAfterFidelityRejection = true
        }

        logger.info(
          `[long-take] TTS/ASR voiceover started ${formatLogFields({
            ...activityLogFields,
            source: 'tts_asr',
            stage: 'voiceover',
            projectId,
            userId,
            voiceId: voiceId || defaultVoiceId(),
            regeneratingAfterFidelityRejection,
          })}`,
        )

        const storage = createLongTakeStorage(projectId)

        // --- Dev cache: reuse TTS + transcript across projects with same script ---
        // A cache hit returns before the forced `.m4a` rewrite further down, so it has
        // to force the rewrite itself: otherwise a rejected take whose `.m4a` delete
        // failed keeps that file, and the editor and BGM remux read it.
        const ttsCached = await tryRestoreTtsFromCache(
          projectId,
          voiceId || defaultVoiceId(),
          storage,
          { forceM4aRewrite: regeneratingAfterFidelityRejection, orgId },
        )
        if (ttsCached) {
          logger.info(
            `[long-take] TTS/ASR voiceover restored from dev-cache ${formatLogFields({
              ...activityLogFields,
              source: 'tts_asr_cache',
              stage: 'voiceover',
              projectId,
              userId,
              audioDurationSeconds: ttsCached.audioDurationSeconds,
              durationMs: Date.now() - startedAt,
            })}`,
          )
          return ttsCached
        }

        // Source the planner's script language (BCP-47) from long-take global
        // constraints and forward it so each TTS provider renders in-locale instead of
        // defaulting to an English-accented voice. Reuses the cached, validated reader.
        const globalContext = await getLongTakeKeyframeGlobalContext(storage, projectId)
        const result = await runTtsAndAsrOrchestration(
          projectId,
          userId,
          voiceId || defaultVoiceId(),
          userEmail,
          {
            languageCode: globalContext?.scriptLanguage,
            // The unit `fal_voice_clone` buckets on. Without it the provider
            // router cannot match the gate's org rule, so every preset stays on MiniMax
            // while the preview path sends the same voice to fal.
            orgId,
            // Captured so a failure can be tagged with the vendor that failed.
            // The router reports it before synthesis, so it survives a throw; `result`
            // does not.
            onProviderResolved: (resolved) => {
              resolvedTtsProvider = resolved
            },
            skipCorrection,
          },
        )
        let audioDurationSeconds: number | undefined

        if (result.voice_over_path) {
          const resolved = await resolveVoiceOverToLocal(result.voice_over_path, storage, projectId)

          try {
            audioDurationSeconds = await getVideoDurationSeconds(resolved.localPath)
          } finally {
            if (resolved.tempDir) {
              await fs.promises.rm(resolved.tempDir, { recursive: true, force: true })
            }
          }
        }

        const isVoiceClone = await isLongTakeUserVoiceCloneVoiceId(voiceId || defaultVoiceId())
        const speedupOutcome =
          !isVoiceClone && result.voice_over_path && result.transcript_path
            ? await maybeSpeedUpStoryModeVoiceover()
            : undefined
        if (speedupOutcome?.audioDurationSeconds) {
          audioDurationSeconds = speedupOutcome.audioDurationSeconds
        }

        // After a fidelity rejection the previous `.m4a` describes the take we just
        // threw away, so it must be rewritten even if clearing it failed above --
        // the editor and BGM remux read that file, not the mp3.
        await generateLongTakeVoiceoverM4a(
          projectId,
          regeneratingAfterFidelityRejection ? { skipIfExists: false } : {},
        )

        // --- Dev cache: save TTS result for future runs ---
        await saveTtsToCache(
          projectId,
          voiceId || defaultVoiceId(),
          storage,
          audioDurationSeconds,
          result.ttsProvider,
          orgId,
        )

        logger.info(
          `[long-take] TTS/ASR voiceover completed ${formatLogFields({
            ...activityLogFields,
            source: 'tts_asr',
            stage: 'voiceover',
            projectId,
            userId,
            transcriptPath: result.transcript_path,
            voiceOverPath: result.voice_over_path,
            audioDurationSeconds,
            speedupApplied: speedupOutcome?.applied,
            speedupPostWpm: speedupOutcome?.postWpm,
            speedupPreWpm: speedupOutcome?.preWpm,
            speedupRatio: speedupOutcome?.ratio,
            speedupSkipReason: speedupOutcome?.skipReason,
            speedupSkippedForVoiceClone: isVoiceClone,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          audioDurationSeconds,
          ...buildFasterTtsVoiceoverResult(
            speedupOutcome,
            isVoiceClone ? 'voice-clone' : undefined,
          ),
          transcriptPath: result.transcript_path,
          ttsProvider: result.ttsProvider,
          voiceOverPath: result.voice_over_path,
          voiceSubstituted: result.voiceSubstituted,
        }
      } catch (error) {
        const err = formatError(error)
        const isControlFlow = isVoiceoverControlFlowError(error)
        logger.error(
          `[long-take] Voiceover generation failed ${formatLogFields({
            ...activityLogFields,
            source: audioPath && !regeneratingAfterFidelityRejection ? 'uploaded_audio' : 'tts_asr',
            stage: 'voiceover',
            projectId,
            userId,
            voiceId: voiceId || defaultVoiceId(),
            audioPath,
            errorName: err.name,
            isControlFlow,
            err,
          })}`,
        )
        if (isControlFlow) {
          throw error
        }
        throwTtsProviderFailure(error, resolvedTtsProvider)
      }
    }),
  )
}

/**
 * Standalone LLM transcript-correction activity. Called from the workflow
 * AFTER `generateLongTakeVoiceover` (when invoked with `skipCorrection: true`)
 * so that correction failures show up as a separate activity instead of
 * being buried inside the voiceover activity.
 *
 * Reads the raw transcript previously written to storage by the voiceover
 * activity, runs `correctTranscriptAndValidateTTSQuality` (chunked at
 * 15 segments / pLimit(5) for long videos), and overwrites the same storage
 * path with the corrected transcript. The corrected file replaces the raw
 * one in place so downstream consumers (LCS aligner, beat-sheet expert)
 * always read `transformed_transcript.json` regardless of whether
 * correction is split out or inline.
 *
 * Returns a small metadata summary instead of the full transcript so the
 * activity-result payload stays tiny.
 */
export async function correctLongTakeTranscript(
  params: CorrectLongTakeTranscriptActivityParams,
): Promise<CorrectLongTakeTranscriptActivityResult> {
  const { projectId, userEmail, userId } = params
  return withLongTakeContext({ projectId, userId, userEmail }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      // Use createLongTakeStorage (not createStorage) so this activity reads/
      // writes from the same ProjectStore scope as every other long-take stage.
      // createStorage has conditional eval-sandbox / V1-local fallbacks that
      // would route the corrected transcript to a different bucket; downstream
      // LCS aligner reads from the ProjectStore path and would silently see the
      // pre-correction raw transcript.
      const storage = createLongTakeStorage(projectId)
      const transcriptPath = STORY_LOADER_PATHS.transformedTranscriptPath
      const scriptPath = STORY_LOADER_PATHS.scriptTxtPath
      const rawTranscript = (await storage.readJsonFile(transcriptPath)) as TranscriptData
      const scriptText = await storage.readTextFile(scriptPath)
      const debugDir = 'story_loader/transcript/debug'

      const correctionResult = await correctTranscriptAndValidateTTSQuality(
        rawTranscript,
        scriptText,
        debugDir,
        projectId,
      )

      // Overwrite the raw transcript with the corrected version so downstream
      // stages read from the same path regardless of whether correction was
      // inline (legacy path) or a separate activity (split path).
      await storage.writeJsonFile(transcriptPath, correctionResult.correctedTranscript)

      logger.info(
        `[long-take] Transcript correction completed ${formatLogFields({
          projectId,
          userId,
          inputSegments: rawTranscript.segments.length,
          outputSegments: correctionResult.correctedTranscript.segments.length,
          hasCorrections: correctionResult.hasCorrections,
          isValid: correctionResult.qualityValidation.isValid,
          confidence: correctionResult.qualityValidation.confidence,
          issuesCount: correctionResult.qualityValidation.issues.length,
          durationMs: Date.now() - startedAt,
        })}`,
      )

      return {
        hasCorrections: correctionResult.hasCorrections,
        isValid: correctionResult.qualityValidation.isValid,
        issuesCount: correctionResult.qualityValidation.issues.length,
        segmentsCount: correctionResult.correctedTranscript.segments.length,
      }
    }),
  )
}

/**
 * Stage 1 of the uploaded-audio pipeline used by the UIP pre-voiceover
 * workflow. Runs download + normalize + ASR + forced-alignment fallback,
 * then writes `transcript.json` and `script.txt` to storage. Intentionally
 * does NOT upload the normalized mp3 to the final voiceover path so the
 * activity returns as soon as ASR completes -- the parent workflow can
 * then signal the UIP session that the script is ready (cutting 10-20s
 * off the `bootstrap_script` wait compared to awaiting the legacy
 * one-shot `generateLongTakeVoiceover` activity).
 *
 * The final mp3 upload + m4a backup live in stage 2
 * (`finalizeVoiceoverAudioArtifacts`). Stage 2 re-downloads + re-normalizes
 * the source audio because activity-local temp files do not cross the
 * activity boundary; this extra I/O is 2-5s for the typical <=4min audio
 * and is dominated by the savings above.
 */
export interface FinalizeVoiceoverAudioArtifactsParams {
  audioPath: string
  projectId: string
  userEmail?: string
  userId: string
}

export interface FinalizeVoiceoverAudioArtifactsResult {
  audioDurationSeconds?: number
  voiceOverPath: string
}

/**
 * Enforce the Story Mode audio upload cap. Shared by the three uploaded-audio
 * entry points (ASR stage 1, finalize stage 2, combined voiceover) so the
 * ceiling and error copy live in one place.
 */
export async function runAsrForUploadedAudio(
  params: RunAsrForUploadedAudioParams,
): Promise<RunAsrForUploadedAudioResult> {
  const { projectId, userId, userEmail, audioPath, confirmedScript } = params
  return withLongTakeContext({ projectId, userId, userEmail }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)
      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), `long-take-asr-${projectId}-`),
      )
      const sourceExtension = (path.extname(audioPath) || '').toLowerCase() || '.bin'
      const downloadedPath = path.join(tempDir, `source${sourceExtension}`)
      const localMp3Path = path.join(tempDir, 'voice_over.mp3')

      try {
        const sourceUri = isStoreUri(audioPath) ? audioPath : storage.getFullPath(audioPath)
        await downloadAssetToLocal(sourceUri, downloadedPath)
        await normalizeVoiceOverToMp3(downloadedPath, localMp3Path)

        const audioDurationSeconds = await getVideoDurationSeconds(localMp3Path)
        assertAudioDurationWithinCap(audioDurationSeconds)

        const asr = await performAsrAndDeriveScript(
          localMp3Path,
          confirmedScript,
          projectId,
          audioDurationSeconds,
        )

        await storage.ensureDir(path.dirname(STORY_LOADER_PATHS.transformedTranscriptPath))
        await storage.writeJsonFile(
          STORY_LOADER_PATHS.transformedTranscriptPath,
          asr.transcriptData,
        )

        const scriptForDisplay = confirmedScript?.trim() || asr.scriptText || ''
        await storage.ensureDir(path.dirname(STORY_LOADER_PATHS.scriptTxtPath))
        await storage.writeFile(STORY_LOADER_PATHS.scriptTxtPath, scriptForDisplay)

        logger.info(
          `[long-take] ASR stage completed ${formatLogFields({
            projectId,
            userId,
            audioPath,
            scriptTextLength: asr.scriptText.length,
            segmentCount: asr.transcriptData.segments?.length ?? 0,
            audioDurationSeconds,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          audioDurationSeconds,
          scriptText: asr.scriptText,
          transcriptPath: STORY_LOADER_PATHS.transformedTranscriptPath,
        }
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true })
      }
    }),
  )
}

function assertAudioDurationWithinCap(audioDurationSeconds: number): void {
  const maxAudioSec = EXPANDED_STORY_MODE_LIMITS.maxAudioUploadSeconds
  if (audioDurationSeconds > maxAudioSec) {
    const maxMinutes = Math.round(maxAudioSec / 60)
    throw new Error(`Audio duration exceeds ${maxMinutes} minutes. Please upload a shorter file.`)
  }
}

/**
 * Stage 2 of the uploaded-audio pipeline. Re-downloads + re-normalizes the
 * source audio, uploads the canonical mp3 to `audioVoiceoverPath`, and
 * generates the m4a backup. Runs AFTER the pre-voiceover workflow has
 * already signalled the UIP parent that the script is ready, so its
 * duration does not block the planner.
 */
export async function finalizeVoiceoverAudioArtifacts(
  params: FinalizeVoiceoverAudioArtifactsParams,
): Promise<FinalizeVoiceoverAudioArtifactsResult> {
  const { projectId, userId, userEmail, audioPath } = params
  return withLongTakeContext({ projectId, userId, userEmail }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)
      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), `long-take-finalize-${projectId}-`),
      )
      const sourceExtension = (path.extname(audioPath) || '').toLowerCase() || '.bin'
      const downloadedPath = path.join(tempDir, `source${sourceExtension}`)
      const localMp3Path = path.join(tempDir, 'voice_over.mp3')

      try {
        const sourceUri = isStoreUri(audioPath) ? audioPath : storage.getFullPath(audioPath)
        await downloadAssetToLocal(sourceUri, downloadedPath)
        await normalizeVoiceOverToMp3(downloadedPath, localMp3Path)

        const audioDurationSeconds = await getVideoDurationSeconds(localMp3Path)
        // Stage 1 (`runAsrForUploadedAudio`) already enforces this cap before
        // signaling the parent, so reaching stage 2 over the cap implies stage
        // 1 was bypassed or the audio file was swapped between stages. Re-check
        // here so a direct caller of stage 2 (audio-replace, manual retry)
        // cannot smuggle an oversize upload.
        assertAudioDurationWithinCap(audioDurationSeconds)

        await storage.ensureDir(path.dirname(STORY_LOADER_PATHS.audioVoiceoverPath))
        await storage.uploadFile(localMp3Path, STORY_LOADER_PATHS.audioVoiceoverPath)
        await generateLongTakeVoiceoverM4a(projectId)

        logger.info(
          `[long-take] Voiceover finalize stage completed ${formatLogFields({
            projectId,
            userId,
            audioPath,
            voiceOverPath: STORY_LOADER_PATHS.audioVoiceoverPath,
            audioDurationSeconds,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          audioDurationSeconds,
          voiceOverPath: STORY_LOADER_PATHS.audioVoiceoverPath,
        }
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true })
      }
    }),
  )
}

/**
 * Resolve a voice-over path (remote URI or storage-relative) to a local file path.
 * If the file is remote, it is downloaded to a temp directory.
 */
// Exported so the extracted pre-voiceover-speed activity can regenerate the
// m4a after re-timing the voiceover (see ./pre-voiceover-speed).
export async function generateLongTakeVoiceoverM4a(
  projectId: string,
  options: { skipIfExists?: boolean } = {},
): Promise<void> {
  const storage = createLongTakeStorage(projectId)
  const voiceOverUri = storage.getFullPath(STORY_LOADER_PATHS.audioVoiceoverPath)
  const m4aUri = voiceOverUri.replace(/\.mp3$/i, '.m4a')

  try {
    const transcoded = await transcodeAudioToM4a(voiceOverUri, m4aUri, {
      skipIfExists: options.skipIfExists ?? true,
    })

    if (!transcoded) {
      logger.warn(
        `[long-take] Failed to generate voiceover m4a preview ${formatLogFields({
          projectId,
          m4aUri,
          voiceOverUri,
        })}`,
      )
    }
  } catch (error) {
    logger.warn(
      `[long-take] Voiceover m4a preview generation failed ${formatLogFields({
        projectId,
        err: formatError(error),
        m4aUri,
        voiceOverUri,
      })}`,
    )
  }
}

const execFileAsync = promisify(execFile)

/**
 * Normalize a voice-over source file to a canonical mp3 on disk, regardless
 * of input format. Video containers get audio extracted (`-vn`); non-mp3
 * audio formats (`.wav`, `.m4a`, `.ogg`, `.flac`, etc.) get transcoded. This
 * guarantees that the canonical `audioVoiceoverPath` asset is always a
 * real mp3, which downstream code (the `.mp3` to `.m4a` regex in
 * `generateLongTakeVoiceoverM4a`, Gemini `audio_url` consumer, etc.)
 * silently depends on.
 */
async function normalizeVoiceOverToMp3(
  downloadedSourcePath: string,
  outputMp3Path: string,
): Promise<void> {
  const extension = path.extname(downloadedSourcePath).toLowerCase().replace(/^\./, '')
  if (extension === 'mp3') {
    if (downloadedSourcePath !== outputMp3Path) {
      await fs.promises.copyFile(downloadedSourcePath, outputMp3Path)
    }
    return
  }
  // `-vn` is a no-op for audio-only inputs and strips the video track
  // for video containers. One uniform invocation handles both.
  await execFileAsync('ffmpeg', [
    '-i',
    downloadedSourcePath,
    '-vn',
    '-acodec',
    'libmp3lame',
    '-y',
    outputMp3Path,
  ])
}

/**
 * Clear the canonical voiceover artifacts before regenerating after a fidelity
 * rejection.
 *
 * The rejecting attempt itself publishes nothing (the gate runs before every
 * write), but an EARLIER attempt of this same activity can have published a full
 * mp3 + transcript pair and then failed downstream -- ASR is non-deterministic, so
 * the retry that lands here may be the first one to fail the gate. Left in place,
 * `runTtsAndAsrOrchestration` sees that pair, takes its existing-artifact
 * short-circuit, and hands the earlier take back untouched. The stale `.m4a` goes
 * too, since the editor and BGM remux both read it.
 *
 * Throws when the mp4/transcript pair is still intact afterwards. That
 * short-circuit keys on BOTH files, so clearing either one disarms it -- but if
 * neither could be removed, regenerating would quietly return the take we just
 * rejected. Failing here instead lets the engine retry the activity, which is the
 * only outcome that does not risk shipping unverified audio.
 */
async function discardRejectedVoiceoverArtifacts(
  storage: ReturnType<typeof createLongTakeStorage>,
  projectId: string,
): Promise<void> {
  const voiceoverPath = STORY_LOADER_PATHS.audioVoiceoverPath
  const transcriptPath = STORY_LOADER_PATHS.transformedTranscriptPath
  const shortCircuitPaths = [voiceoverPath, transcriptPath]
  const stalePaths = [voiceoverPath, voiceoverPath.replace(/\.mp3$/i, '.m4a'), transcriptPath]
  const failedPaths: string[] = []

  for (const stalePath of stalePaths) {
    try {
      if (await storage.exists(stalePath)) {
        await storage.deleteFile(stalePath)
      }
    } catch (error) {
      failedPaths.push(stalePath)
      logger.warn(
        `[long-take] Failed to clear stale voiceover artifact before regeneration ${formatLogFields(
          { projectId, stalePath, err: formatError(error) },
        )}`,
      )
    }
  }

  if (shortCircuitPaths.every((shortCircuitPath) => failedPaths.includes(shortCircuitPath))) {
    throw new Error(
      `Rejected voiceover artifacts could not be cleared for ${projectId}; refusing to regenerate over an intact voice_over.mp3 + transcript pair.`,
    )
  }
}

/**
 * ASR an existing audio file and publish it as the project voiceover.
 *
 * Returns `null` when `audioSource` is `tts_preview` and the ASR of that audio
 * failed `checkTranscriptFidelity` against `confirmedScript`. In that case only
 * `script.txt` is written -- the audio and transcript are deliberately left
 * unpublished so the caller can regenerate through the gated TTS path.
 */
async function processLongTakeUploadedAudio(params: {
  audioPath: string
  audioSource?: 'tts_preview' | 'user_upload'
  confirmedScript?: string
  projectId: string
}): Promise<GenerateLongTakeVoiceoverActivityResult | null> {
  const { audioPath, audioSource, confirmedScript, projectId } = params
  const storage = createLongTakeStorage(projectId)
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `long-take-audio-${projectId}-`))
  // Derive the true extension so we don't save non-mp3 bytes under a
  // `.mp3` filename (which would break `generateLongTakeVoiceoverM4a`'s
  // extension regex and any downstream `audio/*` MIME expectations).
  const sourceExtension = (path.extname(audioPath) || '').toLowerCase() || '.bin'
  const downloadedPath = path.join(tempDir, `source${sourceExtension}`)
  const localAudioPath = path.join(tempDir, 'voice_over.mp3')

  try {
    const sourceUri = isStoreUri(audioPath) ? audioPath : storage.getFullPath(audioPath)
    await downloadAssetToLocal(sourceUri, downloadedPath)
    await normalizeVoiceOverToMp3(downloadedPath, localAudioPath)

    const audioDurationSeconds = await getVideoDurationSeconds(localAudioPath)
    assertAudioDurationWithinCap(audioDurationSeconds)

    const asr = await performAsrAndDeriveScript(
      localAudioPath,
      confirmedScript,
      projectId,
      audioDurationSeconds,
    )
    const { scriptSource, scriptText } = asr
    let { transcriptData } = asr

    // The TTS insertion gate, extended to the UIP preview handoff.
    // That handoff ships TTS audio down this uploaded-audio path, so the gate
    // inside `runTtsAndAsrOrchestration` never sees it and a hallucinated line
    // would be written straight into the transcript the LCS aligner and
    // beat-sheet expert consume. Only `tts_preview` audio is held to the script:
    // a genuine user recording legitimately diverges from the text it was typed
    // against, so gating it would reject valid uploads.
    const confirmedScriptForFidelity = confirmedScript?.trim()
    if (audioSource === 'tts_preview' && confirmedScriptForFidelity) {
      // A forced-alignment transcript is derived FROM the confirmed script, so
      // comparing the two is circular and would always pass -- the gate would
      // silently no-op exactly when ASR is unavailable. Say so instead: the
      // transcript is still script-clean (nothing invented reaches downstream),
      // and re-rendering on a transient ElevenLabs ASR failure would bill a
      // spurious take.
      if (scriptSource === 'forced_alignment') {
        logger.warn(
          `[long-take] Preview handoff audio fidelity unverifiable ${formatLogFields({
            projectId,
            audioPath,
            audioSource,
            reason: 'transcript recovered by forced alignment, not ASR',
            audioDurationSeconds,
          })}`,
        )
      } else {
        const fidelity = checkTranscriptFidelity(confirmedScriptForFidelity, scriptText)
        if (!fidelity.isValid) {
          await discardRejectedVoiceoverArtifacts(storage, projectId)
          // Publish the script alone, for the regeneration below to read back.
          await storage.ensureDir(path.dirname(STORY_LOADER_PATHS.scriptTxtPath))
          await storage.writeFile(STORY_LOADER_PATHS.scriptTxtPath, confirmedScriptForFidelity)
          logger.warn(
            `[long-take] Preview handoff audio rejected by fidelity gate ${formatLogFields({
              projectId,
              audioPath,
              audioSource,
              issues: fidelity.issues.join(' | '),
              audioDurationSeconds,
            })}`,
          )
          return null
        }
        // The take says the confirmed script: time the captions from the script on this
        // computer, like a fresh TTS voiceover, instead of from the ASR words.
        transcriptData =
          (await retimeTranscriptOnScript({
            durationSeconds: audioDurationSeconds,
            language: transcriptData.language,
            localAudioPath,
            projectId,
            script: confirmedScriptForFidelity,
          })) ?? transcriptData
      }
    }

    await storage.ensureDir(path.dirname(STORY_LOADER_PATHS.audioVoiceoverPath))
    await storage.uploadFile(localAudioPath, STORY_LOADER_PATHS.audioVoiceoverPath)
    await generateLongTakeVoiceoverM4a(projectId)

    await storage.ensureDir(path.dirname(STORY_LOADER_PATHS.transformedTranscriptPath))
    await storage.writeJsonFile(STORY_LOADER_PATHS.transformedTranscriptPath, transcriptData)

    // Prefer the user-confirmed script for script.txt so the viewer transcript
    // matches what the user approved. Fall back to ASR text for backwards compat.
    const scriptForDisplay = confirmedScript?.trim() || scriptText || ''
    await storage.ensureDir(path.dirname(STORY_LOADER_PATHS.scriptTxtPath))
    await storage.writeFile(STORY_LOADER_PATHS.scriptTxtPath, scriptForDisplay)

    return {
      audioDurationSeconds,
      scriptText,
      transcriptPath: STORY_LOADER_PATHS.transformedTranscriptPath,
      voiceOverPath: STORY_LOADER_PATHS.audioVoiceoverPath,
    }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

async function resolveVoiceOverToLocal(
  voiceOverPath: string,
  storage: ReturnType<typeof createLongTakeStorage>,
  projectId: string,
): Promise<{ localPath: string; tempDir?: string }> {
  const isRemote = isStoreUri(voiceOverPath) || voiceOverPath.startsWith('http')

  if (isRemote) {
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), `long-take-voice-${projectId}-`),
    )
    try {
      const localPath = path.join(tempDir, 'voice_over.mp3')
      await downloadAssetToLocal(voiceOverPath, localPath)
      return { localPath, tempDir }
    } catch (error) {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
      throw error
    }
  }

  const fullPath = storage.getFullPath(voiceOverPath)
  if (isStoreUri(fullPath)) {
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), `long-take-voice-${projectId}-`),
    )
    try {
      const localPath = path.join(tempDir, 'voice_over.mp3')
      await downloadAssetToLocal(fullPath, localPath)
      return { localPath, tempDir }
    } catch (error) {
      await fs.promises.rm(tempDir, { recursive: true, force: true })
      throw error
    }
  }

  return { localPath: fullPath }
}

// TTS dev-cache: cache audio + ASR transcript by (script + voiceId) so
// subsequent runs get byte-identical transcripts and deterministic LLM keys.

type TtsCacheMeta = {
  audioDurationSeconds?: number
  ttsProvider?: 'byteplus' | 'elevenlabs' | 'fal' | 'gemini' | 'kokoro' | 'minimax' | 'qwen3'
}

function buildFasterTtsVoiceoverResult(
  outcome: StoryModeAudioSpeedupOutcome | undefined,
  ineligibleReason?: GenerateLongTakeVoiceoverActivityResult['fasterTtsSkipReason'],
): Pick<
  GenerateLongTakeVoiceoverActivityResult,
  | 'fasterTtsApplied'
  | 'fasterTtsCohort'
  | 'fasterTtsEvaluated'
  | 'fasterTtsPostWpm'
  | 'fasterTtsPreWpm'
  | 'fasterTtsRatio'
  | 'fasterTtsSkipReason'
  | 'fasterTtsTargetWpm'
  | 'fasterTtsWasCapped'
> {
  if (!outcome) {
    return {
      fasterTtsApplied: false,
      fasterTtsCohort: 'not_evaluated',
      fasterTtsEvaluated: false,
      ...(ineligibleReason ? { fasterTtsSkipReason: ineligibleReason } : {}),
    }
  }
  return {
    fasterTtsApplied: outcome.applied,
    fasterTtsCohort: outcome.skipReason === 'flag-off' ? 'legacy' : 'faster_tts',
    fasterTtsEvaluated: true,
    fasterTtsPostWpm: roundFinitePositive(outcome.postWpm),
    fasterTtsPreWpm: roundFinitePositive(outcome.preWpm),
    fasterTtsRatio: roundFinitePositive(outcome.ratio),
    fasterTtsSkipReason: outcome.skipReason,
    fasterTtsTargetWpm: roundFinitePositive(outcome.targetWpm),
    fasterTtsWasCapped: outcome.wasCapped,
  }
}

async function buildTtsCacheParams(
  storage: ReturnType<typeof createLongTakeStorage>,
  voiceId: string,
  orgId: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!isCacheEnabled()) {
    return undefined
  }
  try {
    const script = await storage.readTextFile(STORY_LOADER_PATHS.scriptTxtPath)
    // orgId is part of the key because it decides the VENDOR: `fal_voice_clone` is
    // bucketed per org, so the same script and voiceId render on fal for
    // one org and on MiniMax for another. Without it a hit from the gated cohort
    // hands its fal audio to an ungated org, which both sounds wrong and hides the
    // routing under test. The cache is dev/staging-only (`isCacheEnabled`), so this
    // narrows reuse exactly where the two cohorts coexist and nowhere else.
    return { _type: 'tts-voiceover', orgId: orgId || '', script, voiceId }
  } catch {
    return undefined
  }
}

function roundFinitePositive(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return Math.round(value * 100) / 100
}

async function saveTtsToCache(
  projectId: string,
  voiceId: string,
  storage: ReturnType<typeof createLongTakeStorage>,
  audioDurationSeconds: number | undefined,
  ttsProvider: TtsCacheMeta['ttsProvider'],
  orgId: string | undefined,
): Promise<void> {
  const params = await buildTtsCacheParams(storage, voiceId, orgId)
  if (!params) {
    return
  }

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `long-take-tts-save-${projectId}-`),
  )
  try {
    const localAudioPath = path.join(tempDir, 'voice_over.mp3')
    const localTranscriptPath = path.join(tempDir, 'transformed_transcript.json')

    await downloadAssetToLocal(
      storage.getFullPath(STORY_LOADER_PATHS.audioVoiceoverPath),
      localAudioPath,
    )
    await downloadAssetToLocal(
      storage.getFullPath(STORY_LOADER_PATHS.transformedTranscriptPath),
      localTranscriptPath,
    )

    const meta: TtsCacheMeta = { audioDurationSeconds }
    if (ttsProvider) {
      meta.ttsProvider = ttsProvider
    }

    tryWriteBinary(params, meta, [
      { index: 0, ext: 'mp3', data: await fs.promises.readFile(localAudioPath) },
      { index: 1, ext: 'json', data: await fs.promises.readFile(localTranscriptPath) },
    ])
  } catch (error) {
    logger.warn(
      `[long-take] TTS dev-cache save failed ${formatLogFields({
        projectId,
        err: formatError(error),
      })}`,
    )
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

async function tryRestoreTtsFromCache(
  projectId: string,
  voiceId: string,
  storage: ReturnType<typeof createLongTakeStorage>,
  options: { forceM4aRewrite?: boolean; orgId?: string } = {},
): Promise<GenerateLongTakeVoiceoverActivityResult | undefined> {
  const params = await buildTtsCacheParams(storage, voiceId, options.orgId)
  if (!params) {
    return undefined
  }

  const meta = await tryReadBinaryMeta<TtsCacheMeta>(params)
  if (!meta || meta.binaries.length < 2) {
    return undefined
  }

  const audioPath = STORY_LOADER_PATHS.audioVoiceoverPath
  const transcriptPath = STORY_LOADER_PATHS.transformedTranscriptPath

  await storage.ensureDir(path.dirname(audioPath))
  await storage.ensureDir(path.dirname(transcriptPath))

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `long-take-tts-restore-${projectId}-`),
  )
  try {
    const localAudioPath = path.join(tempDir, 'voice_over.mp3')
    const localTranscriptPath = path.join(tempDir, 'transformed_transcript.json')
    await saveCachedBinaryToFile(meta.key, 0, localAudioPath, 'mp3')
    await saveCachedBinaryToFile(meta.key, 1, localTranscriptPath, 'json')
    await storage.uploadFile(localAudioPath, audioPath)
    await storage.uploadFile(localTranscriptPath, transcriptPath)
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }

  await generateLongTakeVoiceoverM4a(
    projectId,
    options.forceM4aRewrite ? { skipIfExists: false } : {},
  )

  logger.info('[long-take] TTS dev-cache hit, restored audio + transcript')
  return {
    audioDurationSeconds: meta.result.audioDurationSeconds,
    fasterTtsApplied: false,
    fasterTtsCohort: 'not_evaluated',
    fasterTtsEvaluated: false,
    fasterTtsSkipReason: 'tts-cache-hit',
    transcriptPath,
    ttsProvider: meta.result.ttsProvider,
    voiceOverPath: audioPath,
  }
}
