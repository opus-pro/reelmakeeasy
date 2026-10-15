/**
 * Activity proxies for the pre-voiceover workflow.
 *
 * The uploaded-audio pipeline is split into three activities so the UIP parent
 * can be notified (via `preVoiceoverScriptReadySignal`) as soon as ASR
 * finishes, cutting the `bootstrap_script` wait by the time it would
 * otherwise take to upload the canonical mp3 + generate the m4a backup:
 *
 * - Stage 1 `runAsrForUploadedAudio` -- download + normalize + ASR + forced
 *   alignment + write `transcript.json` + write `script.txt`. Does NOT
 *   upload the canonical mp3.
 *
 * - Stage 2 `finalizeVoiceoverAudioArtifacts` -- re-download + re-normalize
 *   + upload canonical mp3 + m4a backup. Runs after the parent signal has
 *   already been sent, so its duration does not block the UIP planner.
 *
 * - Stage 3 `analyzeLongTakeVoiceCharacter` -- multimodal LLM call against
 *   the uploaded audio (first 30s) to extract gender / age / voice qualities,
 *   written to `long_take/voice_character.json`. Consumed by UIP anchor
 *   generation to soft-bias narrator visual characteristics. Failure here
 *   is non-fatal -- caught at workflow level so confirm flow is not blocked.
 *
 * Retry semantics, heartbeats, and telemetry are shared via `proxyActivitiesWrapper`.
 * See `libs/story-mode-runtime/src/activities/long-take/audio.ts` and
 * `libs/story-mode-runtime/src/activities/long-take/voice-character.ts` for
 * the implementations.
 */

import { MUSIC_ANALYSIS_BASE_TASK_QUEUE } from '@reelmakeeasy/common/long-take/music-analysis-routing-constants'
import { proxyActivitiesWrapper } from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'

import type { analyzeMusicBeatGrid as analyzeMusicBeatGridActivity } from '../../activities/long-take/music-beat-grid'
import type { detectIfMusic as detectIfMusicActivity } from '../../activities/long-take/music-detection'
import type * as activities from '../long-take/activities'

export const {
  runAsrForUploadedAudio,
  finalizeVoiceoverAudioArtifacts,
  analyzeLongTakeVoiceCharacter,
} = proxyActivitiesWrapper<
  Pick<
    typeof activities,
    'analyzeLongTakeVoiceCharacter' | 'finalizeVoiceoverAudioArtifacts' | 'runAsrForUploadedAudio'
  >
>({
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
  },
})

// Stage 4 (music pre-analysis): librosa beat-grid on the dedicated music-analysis queue.
// Same import-type pattern as the long-take proxies -- the activity is registered only on that
// worker. Best-effort: bounded retries so a music-worker outage cannot stall the child tail.
// `scheduleToCloseTimeout` is the load-bearing bound -- same rationale as detectIfMusic
// below: without it a music-worker outage / queue backlog parks the task in SCHEDULED forever
// (startToClose only ticks once a worker picks it up), so MusicPreAnalysisWorkflow never reaches
// its non-fatal catch and never signals beat-sheet readiness -- which would hang the UIP v2
// music-route hold (advanceScriptReview) until idle-timeout instead of falling back to ASR timing.
// Generous enough for the full 2-attempt chain (2x 6min run + retry intervals + queue wait).
export const { analyzeMusicBeatGrid } = proxyActivitiesWrapper<{
  analyzeMusicBeatGrid: typeof analyzeMusicBeatGridActivity
}>({
  taskQueue: MUSIC_ANALYSIS_BASE_TASK_QUEUE,
  scheduleToCloseTimeout: '15 minutes',
  startToCloseTimeout: '6 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 2,
    initialInterval: '10 seconds',
    maximumInterval: '1 minute',
  },
})

// Tier-2 music detection: YAMNet is-music classifier, registered only
// on the music-analysis worker (same routing as the beat grid). Best-effort with
// a tight budget: the detection result is awaited before the artifacts-ready
// signal, so a music-worker outage must not stall the child's result path.
// `scheduleToCloseTimeout` is the load-bearing bound -- it caps the WHOLE
// attempt chain including queue wait, unlike startToClose which only ticks
// once a worker picks the task up; without it a music-worker outage would
// park the task in SCHEDULED forever and the caller's non-fatal catch would
// never fire.
export const { detectIfMusic } = proxyActivitiesWrapper<{
  detectIfMusic: typeof detectIfMusicActivity
}>({
  taskQueue: MUSIC_ANALYSIS_BASE_TASK_QUEUE,
  scheduleToCloseTimeout: '3 minutes',
  startToCloseTimeout: '90 seconds',
  heartbeatTimeout: '60 seconds',
  retry: {
    maximumAttempts: 2,
    initialInterval: '5 seconds',
    maximumInterval: '30 seconds',
  },
})

// Tier-3 LLM tiebreak, same tight-budget
// posture as detectIfMusic above: these run on the detection path that the
// artifacts-ready signal waits on, so they get their own bounded proxies
// instead of the 20-minute shared group.
export const { classifyUploadedAudioMusicForPreVoiceover: classifyAudioMusicForDetectionTier } =
  proxyActivitiesWrapper<Pick<typeof activities, 'classifyUploadedAudioMusicForPreVoiceover'>>({
    scheduleToCloseTimeout: '3 minutes',
    startToCloseTimeout: '90 seconds',
    heartbeatTimeout: '60 seconds',
    retry: {
      maximumAttempts: 2,
      initialInterval: '5 seconds',
      maximumInterval: '30 seconds',
    },
  })

export const { buildLongTakeMusicBeatSheet } = proxyActivitiesWrapper<
  Pick<typeof activities, 'buildLongTakeMusicBeatSheet'>
>({
  startToCloseTimeout: '2 minutes',
  heartbeatTimeout: '60 seconds',
  retry: {
    maximumAttempts: 2,
    initialInterval: '5 seconds',
    maximumInterval: '30 seconds',
  },
})
