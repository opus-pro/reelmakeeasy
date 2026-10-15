/**
 * Pre-voiceover Workflow (Case 2.1 -- user-uploaded audio)
 *
 * Spawned as a CHILD workflow by uipSessionWorkflow when params.audioPath is
 * set. Runs ASR + writes artifacts to STORY_LOADER_PATHS in two stages:
 *
 *   Stage 1 (`runAsrForUploadedAudio`):
 *     - download + normalize mp3 locally
 *     - ASR + optional forced-alignment fallback
 *     - write `transcript.json` and `script.txt` to storage
 *     - return { scriptText, transcriptPath, audioDurationSeconds }
 *
 *   After stage 1 the child signals the UIP parent via
 *   `preVoiceoverScriptReadySignal` so the parent can unblock
 *   `bootstrap_script` immediately -- it does not need the mp3 or m4a
 *   yet (mp3 is only consumed at post-confirm story-mode handoff;
 *   transcript is consumed later by the VS tool beat-sheet).
 *
 *   Stage 2 (`finalizeVoiceoverAudioArtifacts`):
 *     - re-download + re-normalize mp3
 *     - upload canonical mp3 to `audioVoiceoverPath`
 *     - generate m4a backup
 *
 *   `.result()` only resolves once stage 2 finishes, which is what the
 *   API service awaits at confirm time to populate the `preVoiceover`
 *   handoff into the uipToStoryMode workflow.
 *
 * Failure modes:
 *   - ASR fails / timeout -> parent catches on its signal-race deadline
 *     and flips `_failed` on session state.
 *   - stage 2 fails after signal -> UIP session still succeeds (script
 *     was already seeded); confirm orchestration will fail to fetch
 *     mp3/m4a, which surfaces as a story-mode handoff error handled
 *     by the existing uipToStoryMode failure path.
 *
 * `parentClosePolicy: ABANDON` is used by the parent so that if the parent
 * workflow fails/exits, in-flight ASR work is not cancelled (it writes storage
 * and that's wasted, but harmless -- storage is idempotent).
 */

import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'
import {
  ApplicationFailure,
  getExternalWorkflowHandle,
  log as workflowLog,
  ParentClosePolicy,
  startChild,
} from '@reelmakeeasy/workflow-engine/workflow'

import {
  analyzeLongTakeVoiceCharacter,
  analyzeMusicBeatGrid,
  buildLongTakeMusicBeatSheet,
  classifyAudioMusicForDetectionTier,
  detectIfMusic,
  finalizeVoiceoverAudioArtifacts,
  runAsrForUploadedAudio,
} from './activity-proxies'
import type {
  MusicBeatSheetSignalPayload,
  PreVoiceoverArtifactsReadySignalPayload,
} from './signals'
import {
  musicBeatSheetSignal,
  preVoiceoverArtifactsReadySignal,
  preVoiceoverScriptReadySignal,
} from './signals'
import type { PreVoiceoverWorkflowParams, PreVoiceoverWorkflowResult } from './types'

export interface MusicPreAnalysisWorkflowParams {
  audioPath: string
  /**
   * Entry-point music declaration (song-to-video front door). Overrides
   * librosa's beat-regularity isMusic heuristic so the pre-confirm beat
   * sheet always lands for declared-music sessions.
   */
  isMusic?: boolean
  /**
   * UIP parent workflow id to signal music beat-sheet readiness to.
   * Optional: a direct invocation may omit it, in which case the workflow runs
   * analysis-only without signaling.
   */
  parentWorkflowId?: string
  projectId: string
  transcriptPath: string
  userEmail?: string
  userId?: string
}

type PreVoiceoverMusicDetection = NonNullable<
  PreVoiceoverArtifactsReadySignalPayload['musicDetection']
>

interface TieredMusicDetectionOutcome {
  verdict: TieredMusicDetectionVerdict
}

interface TieredMusicDetectionVerdict extends PreVoiceoverMusicDetection {
  speechProbability?: number
}

// Detached grandchild started by PreVoiceoverWorkflow Stage 4 (ABANDON policy): runs the librosa
// beat-grid analysis on the music-analysis queue and, when the upload is music, persists the
// music beat sheet pre-confirm for the planner's beat-locked preview. Lives outside
// PreVoiceoverWorkflow so its duration can never delay the confirm handoff, which awaits the
// pre-voiceover RESULT. Nothing in this workflow awaits the child; the music-route planner waits
// for the persisted beat sheet at the point where it actually needs beat-locked timing.
export async function MusicPreAnalysisWorkflow(
  params: MusicPreAnalysisWorkflowParams,
): Promise<void> {
  const { audioPath, parentWorkflowId, projectId, transcriptPath, userEmail, userId } = params
  setWorkflowScopedContext({ projectId, userId, userEmail })

  // Report readiness to the UIP parent via a signal instead of having
  // the planner poll beat_sheet.json. A direct invocation without
  // parentWorkflowId runs analysis-only.
  const signalParent = Boolean(parentWorkflowId)

  let status: MusicBeatSheetSignalPayload['status'] = 'unavailable'
  let reason: string | undefined
  try {
    const { beatGrid } = await analyzeMusicBeatGrid({ audioUri: audioPath, projectId, userId })
    // librosa's isMusic is a beat-regularity heuristic computed alongside the
    // grid -- the beats themselves are always returned. A session already
    // declared music at the entry point (params.isMusic) wins over the
    // heuristic so the beat sheet always lands for music sessions.
    if (beatGrid.isMusic || params.isMusic === true) {
      await buildLongTakeMusicBeatSheet({ beatGrid, projectId, transcriptPath, userId })
      status = 'ready'
    } else {
      reason = 'not_music'
    }
  } catch (err) {
    // Beat-grid / sheet build failed (e.g. analysis subprocess OOM).
    // Non-fatal: signal `unavailable` so the parent uses the ASR-timing fallback
    // instead of waiting for a sheet that will never land.
    reason = 'analysis_failed'
    workflowLog.warn(
      `[music-pre-analysis] beat-sheet analysis failed (non-fatal) ${JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
      })}`,
    )
  }

  if (signalParent) {
    try {
      const parent = getExternalWorkflowHandle(parentWorkflowId as string)
      await parent.signal(musicBeatSheetSignal, { status, ...(reason ? { reason } : {}) })
    } catch (err) {
      // Parent already closed / not found: harmless -- the parent's bounded wait
      // falls back on timeout. Never let a signal failure fail this child.
      workflowLog.warn(
        `[music-pre-analysis] failed to signal music_beat_sheet (non-fatal) ${JSON.stringify({
          message: err instanceof Error ? err.message : String(err),
        })}`,
      )
    }
  }
}

export async function PreVoiceoverWorkflow(
  params: PreVoiceoverWorkflowParams,
): Promise<PreVoiceoverWorkflowResult> {
  const { projectId, userId, userEmail, source, audioPath, parentWorkflowId } = params

  // Bind projectId (+ user fields) to this child workflow's scope so the
  // long-take audio activities it schedules (runAsrForUploadedAudio,
  // finalizeVoiceoverAudioArtifacts) emit structured `projectId` log fields.
  // Without this, ASR / finalize logs carry projectId only in the
  // `[long-take]`-prefixed message string, which makes `projectId:<id>`
  // structured-field log searches miss them. The parent UIP workflow
  // already binds its own context; children do not inherit, so this must
  // be set on each child workflow entry independently.
  setWorkflowScopedContext({ projectId, userId, userEmail })

  if (source !== 'user_audio') {
    throw new Error(`Unsupported pre-voiceover source: ${source}`)
  }
  if (!audioPath) {
    throw new Error('pre-voiceover source=user_audio requires audioPath')
  }

  // Entry-point log so ops can tell at a glance that a UIP audio-mode
  // session kicked off its ASR child workflow. Activities inside run under
  // the shared `[long-take]` prefix (they live in long-take/audio.ts), so
  // this is the only place a `[pre-voiceover]`-tagged line appears in
  // the logs. The JSON is inlined into the message string so it renders in
  // the Message column, matching the long-take log style.
  workflowLog.info(
    `[pre-voiceover] Starting ASR for uploaded audio ${JSON.stringify({
      audioPath,
      parentWorkflowId,
      source,
    })}`,
  )

  // Stage 1: ASR + small-file writes. Parent is unblocked as soon as this
  // resolves.
  const asr = await runAsrForUploadedAudio({
    projectId,
    userId,
    userEmail,
    audioPath,
  })
  // No ASR text means no usable transcript: an audio source that produced a
  // transcript artifact but no text is treated as failed ASR, so the parent
  // rejects the upload instead of continuing scriptless.
  const scriptText = asr.scriptText?.trim() ?? ''

  // nonRetryable so the engine fails the execution immediately rather than
  // retrying the workflow task forever.
  if (!asr.transcriptPath || !scriptText) {
    throw ApplicationFailure.nonRetryable('Failed to generate transcript from audio')
  }

  // Signal the parent that the script is ready. Parent holds its
  // `bootstrap_script` gate open on this signal or a fixed timeout
  // (whichever fires first).
  const parent = getExternalWorkflowHandle(parentWorkflowId)
  await parent.signal(preVoiceoverScriptReadySignal, {
    scriptText,
    transcriptPath: asr.transcriptPath,
    audioDurationSeconds: asr.audioDurationSeconds,
  })

  // Tiered content-based music detection, started here so it runs
  // CONCURRENTLY with stages 2-3 (regular activities -- concurrency is
  // replay-safe; only local activities must stay sequential) and its latency
  // hides behind the mp3 upload + voice-character analysis. Awaited just
  // before the artifacts-ready signal so the verdict rides the existing
  // payload (no new signal type; the parent folds it into
  // `spec.meta.audio_is_music`). Never rejects -- failures resolve to null.
  const musicDetectionPromise = maybeRunTieredMusicDetection(params)

  // Stage 2: canonical mp3 upload + m4a backup. Runs in the background
  // from the UIP planner's perspective. `.result()` only resolves once
  // this completes. The duration cap is enforced here too (defense in
  // depth -- the workflow already runs stage 1 first, but a direct caller
  // of stage 2 would otherwise bypass the cap).
  const finalize = await finalizeVoiceoverAudioArtifacts({
    projectId,
    userId,
    userEmail,
    audioPath,
  })

  // Stage 3: voice character analysis. Reads the canonical mp3 written by
  // Stage 2 (so order matters), extracts gender / age / qualities via
  // multimodal LLM, persists to `long_take/voice_character.json`. The
  // file is later read by UIP anchor generation to soft-bias narrator
  // visual characteristics. Failure here is non-fatal: anchor generation
  // falls back to `SessionState.voiceProfile` if the file is missing.
  // `.result()` is delayed by ~30s on success but UIP planner main loop
  // is unaffected (already unblocked by stage 1's signal).
  try {
    await analyzeLongTakeVoiceCharacter({ projectId, userId })
  } catch (err) {
    workflowLog.warn(
      `[pre-voiceover] voice character analysis failed (non-fatal) ${JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
      })}`,
    )
  }

  const musicDetection = await musicDetectionPromise

  await parent.signal(preVoiceoverArtifactsReadySignal, {
    scriptText,
    transcriptPath: asr.transcriptPath,
    voiceOverPath: finalize.voiceOverPath,
    audioDurationSeconds: finalize.audioDurationSeconds ?? asr.audioDurationSeconds,
    source: 'user_audio',
    ...(musicDetection
      ? {
          musicDetection: {
            decidedByTier: musicDetection.verdict.decidedByTier,
            isMusic: musicDetection.verdict.isMusic,
            musicProbability: musicDetection.verdict.musicProbability,
          },
        }
      : {}),
  })

  // Stage 4: music beat-grid pre-analysis, DETACHED. Confirm
  // awaits this child workflow's result via fetchPreVoiceoverHandoff, so the analysis must not
  // sit on the result path -- a slow music-analysis worker would otherwise hold confirm for the
  // full retry window. Start a detached (ParentClosePolicy.ABANDON) grandchild and return
  // immediately: when librosa says
  // the upload is music, the music beat sheet lands at the shared long_take path before confirm
  // and the planner locks spec shot timing to musical beats. Failure is non-fatal: the planner
  // waits for the beat sheet where music preview timing is generated, and the post-confirm
  // workflow re-runs the analysis anyway.
  await maybeStartMusicPreAnalysisChild(params, {
    audioPath,
    parentWorkflowId,
    projectId,
    transcriptPath: asr.transcriptPath,
    userEmail,
    userId,
  })

  return {
    scriptText,
    voiceOverPath: finalize.voiceOverPath,
    transcriptPath: asr.transcriptPath,
    audioDurationSeconds: finalize.audioDurationSeconds ?? asr.audioDurationSeconds,
    source: 'user_audio',
  }
}

/**
 * Stage 4: start the detached (ParentClosePolicy.ABANDON) music beat-grid
 * pre-analysis grandchild, fire-and-forget. Nothing
 * awaits it -- confirm awaits the pre-voiceover RESULT, so a slow music worker must
 * never sit on that path; the music-route planner waits for the persisted sheet (or
 * the readiness signal) where it needs beat-locked timing, and child-start
 * failure is non-fatal. Extracted from PreVoiceoverWorkflow to keep its complexity
 * in check.
 *
 * If startChild itself fails, the grandchild never runs and so never signals
 * readiness -- which would hang the UIP v2 music-route hold (advanceScriptReview) until
 * idle-timeout. So on a start failure we signal the parent `unavailable` directly, so
 * the planner falls back to ASR timing. (The in-child analysis-hang path is bounded
 * separately by analyzeMusicBeatGrid's scheduleToCloseTimeout.)
 */
async function maybeStartMusicPreAnalysisChild(
  params: PreVoiceoverWorkflowParams,
  child: Omit<MusicPreAnalysisWorkflowParams, 'isMusic'>,
): Promise<void> {
  if (params.musicVideoImprovementEnabled !== true) {
    return
  }
  const { parentWorkflowId, ...rest } = child
  try {
    await startChild(MusicPreAnalysisWorkflow, {
      args: [
        {
          ...rest,
          isMusic: params.isMusic,
          parentWorkflowId,
        },
      ],
      parentClosePolicy: ParentClosePolicy.ABANDON,
      workflowId: `ao:${child.projectId}:music-pre-analysis`,
    })
  } catch (err) {
    workflowLog.warn(
      `[pre-voiceover] music pre-analysis child failed to start (non-fatal) ${JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
      })}`,
    )
    await signalMusicBeatSheetUnavailable(parentWorkflowId, 'child_start_failed')
  }
}

/**
 * Best-effort `unavailable` signal to the UIP v2 parent so its music-route
 * hold falls back to ASR timing instead of waiting for a beat sheet that will never
 * land. Needs a present parentWorkflowId; never throws (a closed/absent parent is
 * harmless -- its idle timeout is the ultimate backstop).
 */
async function signalMusicBeatSheetUnavailable(
  parentWorkflowId: string | undefined,
  reason: string,
): Promise<void> {
  if (!parentWorkflowId) {
    return
  }
  try {
    await getExternalWorkflowHandle(parentWorkflowId).signal(musicBeatSheetSignal, {
      reason,
      status: 'unavailable',
    })
  } catch (err) {
    workflowLog.warn(
      `[pre-voiceover] failed to signal music_beat_sheet unavailable (non-fatal) ${JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
      })}`,
    )
  }
}

/**
 * Tiered content-based music detection, with its gates: skipped
 * when the V1 parent did not opt in (V2's artifacts
 * reducer has no fold yet), when the music gate is off (verdict
 * would have no routing effect), or when the song-to-video preset already
 * declared music (nothing to add). Non-fatal and never rejects: a detection
 * failure only means the session keeps the preset/planner signals it
 * already has.
 */
async function maybeRunTieredMusicDetection(
  params: PreVoiceoverWorkflowParams,
): Promise<null | TieredMusicDetectionOutcome> {
  if (
    params.runContentDetection !== true ||
    params.musicVideoImprovementEnabled !== true ||
    params.isMusic === true
  ) {
    // Declared-music (song-to-video) uploads skip ROUTING detection -- the verdict has nothing to
    // add when music is already declared -- but they are the PRIMARY cohort for the YAMNet-vs-Gemini
    // vocal-gender validation. Run the detector here purely for its persisted gender artifact (the
    // verdict is discarded); otherwise `project.long_take.completed` would carry no YAMNet sample
    // for declared-music songs. Best-effort: a music-worker hiccup never affects routing. Latency hides behind the concurrent mp3 upload + voice-character analysis,
    // same as the routing detection below.
    if (params.isMusic === true && Boolean(params.audioPath)) {
      await runVocalGenderValidationOnly(params)
    }
    return null
  }
  try {
    const verdict = await runTieredMusicDetection(params)
    return { verdict }
  } catch (err) {
    workflowLog.warn(
      `[pre-voiceover] tiered music detection failed (non-fatal) ${JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
      })}`,
    )
    return null
  }
}

/**
 * Validation-only YAMNet run for declared-music uploads (whose routing detection is skipped). The
 * verdict is irrelevant here -- `detectIfMusic` persists the vocal-gender artifact as a side effect,
 * which is what `project.long_take.completed` reads to compare YAMNet vs Gemini gender. Best-effort:
 * a failure just means one declared-music project contributes no YAMNet gender sample.
 */
async function runVocalGenderValidationOnly(params: PreVoiceoverWorkflowParams): Promise<void> {
  if (!params.audioPath) {
    return
  }
  try {
    await detectIfMusic({
      audioUri: params.audioPath,
      projectId: params.projectId,
      userId: params.userId,
    })
  } catch (err) {
    workflowLog.warn(
      `[pre-voiceover] vocal-gender validation detection failed (non-fatal) ${JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
      })}`,
    )
  }
}

/**
 * The detection tiers themselves: ID3 vendor tag (decided at session
 * creation, threaded in via params) -> YAMNet probability band (computed
 * activity-side from env so thresholds are tunable without a workflow
 * change) -> Gemini-listen LLM tiebreak for the ambiguous band.
 * Throws propagate to `maybeRunTieredMusicDetection`'s non-fatal catch.
 */
async function runTieredMusicDetection(params: {
  audioIsMusicVendorTag?: string
  audioPath: string
  projectId: string
  userId?: string
}): Promise<TieredMusicDetectionVerdict> {
  if (params.audioIsMusicVendorTag) {
    return { decidedByTier: 'id3', isMusic: true }
  }
  const { band, detection } = await detectIfMusic({
    audioUri: params.audioPath,
    projectId: params.projectId,
    userId: params.userId,
  })
  if (band !== 'ambiguous') {
    return {
      decidedByTier: 'yamnet',
      isMusic: band === 'music',
      musicProbability: detection.musicProbability,
      speechProbability: detection.speechProbability,
    }
  }
  const llm = await classifyAudioMusicForDetectionTier({
    audioPath: params.audioPath,
    projectId: params.projectId,
    userId: params.userId,
  })
  return {
    decidedByTier: 'llm',
    isMusic: llm.isMusic,
    musicProbability: detection.musicProbability,
    speechProbability: detection.speechProbability,
  }
}
