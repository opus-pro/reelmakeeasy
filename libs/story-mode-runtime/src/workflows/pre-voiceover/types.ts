/**
 * Pre-voiceover workflow -- runs ASR on user-uploaded audio to produce a script
 * (and timestamped transcript + normalized voice-over mp3) BEFORE the UIP
 * planner loop needs them. See architecture doc "Pre-voiceover Pipeline".
 *
 * Case 2.1 only: user uploaded audio at session creation.
 * The UIP workflow spawns this as a child workflow (with ABANDON parentClosePolicy)
 * and awaits its result at the bootstrap_script gate. The artifacts are written
 * to the same STORY_LOADER_PATHS that story-mode's downstream stages read, so
 * the post-confirm uipToStoryMode handoff can short-circuit its own voiceover
 * stage.
 */

export interface PreVoiceoverWorkflowParams {
  /**
   * AI-music vendor marker found in the upload's ID3 metadata at session
   * creation (tier 1 of the content detector, e.g. 'suno'). When set, the
   * tiered detection in this workflow reports an 'id3' verdict without
   * running YAMNet / LLM.
   */
  audioIsMusicVendorTag?: string
  /** store path (or relative) of user-uploaded audio. Required for source='user_audio'. */
  audioPath: string
  /**
   * Entry-point music declaration pinned on the UIP session (song-to-video
   * front door). When true, the music pre-analysis child builds the beat
   * sheet even if librosa's beat-regularity heuristic says the upload is not
   * music -- the session was already determined to be music upstream.
   */
  isMusic?: boolean
  /**
   * Session-pinned snapshot of the `enable_music_video_improvement` gate.
   * When false, empty-ASR music uploads keep the legacy failure behavior.
   */
  musicVideoImprovementEnabled?: boolean
  /**
   * Workflow ID of the UIP parent session. The child workflow uses this to
   * signal `preVoiceoverScriptReadySignal` back to the parent as soon as
   * stage 1 (ASR + small-file writes) finishes, so the parent can unblock
   * `bootstrap_script` without waiting for stage 2 (mp3 upload + m4a).
   */
  parentWorkflowId: string
  projectId: string
  /**
   * Enables the tiered content-based music detection. Set by the
   * V1 UIP parent, whose artifacts handler folds the verdict into
   * `spec.meta.audio_is_music`. V2 deliberately leaves this off: its
   * artifacts reducer has no fold yet (tracked with the other V2 music gaps),
   * so running detection there would burn YAMNet/LLM calls and
   * emit telemetry for a verdict with zero product effect.
   */
  runContentDetection?: boolean
  /** Currently only 'user_audio'. Kept as a discriminant for future TTS path. */
  source: 'user_audio'
  userEmail?: string
  userId: string
}

/**
 * Payload sent from the pre-voiceover child to the UIP parent after ASR +
 * transcript/script.txt writes complete but before the mp3 upload / m4a
 * backup finish. See `preVoiceoverScriptReadySignal` in `./signals`.
 */
export interface PreVoiceoverScriptReadyPayload {
  audioDurationSeconds?: number
  scriptText: string
  transcriptPath: string
}

export interface PreVoiceoverWorkflowResult {
  audioDurationSeconds?: number
  /** Plain-text script extracted from ASR. Seeded into UIP's working_script.script. */
  scriptText: string
  source: 'user_audio'
  /** storage-relative path to the TranscriptData JSON with word-level timestamps
   *  (= STORY_LOADER_PATHS.transformedTranscriptPath). Consumed by the VS tool
   *  beat-sheet expert (audio-mode timestamped path) and by story-mode's
   *  downstream experts stage. */
  transcriptPath: string
  /** storage-relative path to the normalized voice_over.mp3 (= STORY_LOADER_PATHS.audioVoiceoverPath). */
  voiceOverPath: string
}
