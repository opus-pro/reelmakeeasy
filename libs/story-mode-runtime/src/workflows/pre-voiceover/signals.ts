// Pre-voiceover child -> parent signal channels + payload shapes.
//
// Relocated VERBATIM out of workflows/uip/types.ts as part of the UIP v1
// directory deletion: the pre-voiceover child workflow owns these
// outbound signals, so they live with the child now that the v1 types module
// is gone. The wire-name strings are unchanged, so the UIP parent (which
// defines its own matching handlers) still receives them -- the engine routes
// signals by name, not by type identity.
//
// Workflow module, kept light: only `@reelmakeeasy/workflow-engine/workflow` is
// value-imported (defineSignal); no `@reelmakeeasy/uip-planner-runtime` value import.

import { defineSignal } from '@reelmakeeasy/workflow-engine/workflow'

/**
 * Payload sent by the pre-voiceover child workflow (stage 1 -> stage 2
 * boundary) to unblock the UIP parent's `bootstrap_script` gate without
 * waiting for the canonical mp3 upload / m4a backup.
 */
export interface PreVoiceoverScriptReadySignalPayload {
  audioDurationSeconds?: number
  scriptText: string
  transcriptPath: string
}

/**
 * Payload sent by the pre-voiceover child workflow after stage 2
 * (`finalizeVoiceoverAudioArtifacts`) completes. Carries canonical
 * voiceover artifact metadata back to the UIP parent.
 */
export interface PreVoiceoverArtifactsReadySignalPayload {
  audioDurationSeconds?: number
  /**
   * Content-based music verdict from the child's tiered detector (ID3
   * vendor tag / YAMNet / LLM). Absent when detection was skipped (gate
   * off, preset already declared music, pre-patch child) or failed. The
   * parent folds `isMusic === true` into `spec.meta.audio_is_music` so
   * prompt routing and the confirm handoff can pick up the signal.
   */
  musicDetection?: {
    decidedByTier: 'id3' | 'llm' | 'yamnet'
    isMusic: boolean
    musicProbability?: number
  }
  scriptText: string
  source: 'user_audio'
  transcriptPath: string
  voiceOverPath: string
}

export const preVoiceoverScriptReadySignal = defineSignal<[PreVoiceoverScriptReadySignalPayload]>(
  'uip-pre-voiceover-script-ready',
)
export const preVoiceoverArtifactsReadySignal = defineSignal<
  [PreVoiceoverArtifactsReadySignalPayload]
>('uip-pre-voiceover-artifacts-ready')

/**
 * Payload sent by `MusicPreAnalysisWorkflow` to the UIP parent once the music
 * beat-sheet pre-analysis resolves (event-driven readiness, replacing
 * the old `beat_sheet.json` polling). `ready` = the beat sheet was built and
 * persisted at the shared `long_take/experts/beat_sheet.json` path; `unavailable`
 * = the upload was not music, or the analysis failed (e.g. beat-grid OOM).
 * On `unavailable` the parent proceeds with the ASR-timing fallback
 * instead of waiting. `reason` is free-text for telemetry/debugging.
 */
export interface MusicBeatSheetSignalPayload {
  reason?: string
  status: 'ready' | 'unavailable'
}

export const musicBeatSheetSignal =
  defineSignal<[MusicBeatSheetSignalPayload]>('uip-music-beat-sheet')
