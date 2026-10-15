/**
 * Abstraction for user voice clone records (routing TTS by provider).
 */
export interface Qwen3SpeakerRecord {
  referenceText?: string
  /** Storage path (`store://...`) of the safetensors speaker embedding. */
  speakerEmbeddingPath: string
}

export interface UserVoiceCloneDataService {
  /**
   * Returns the `provider: 'fal'` voice id that was re-cloned from this
   * MiniMax `voiceId`, or null when the voice has no Fal counterpart yet.
   *
   * Fal clone ids are tenant-scoped, so the A/B cannot serve a MiniMax voice from
   * Fal by reusing its id -- the counterpart is a separate row linked by
   * `migratedFromVoiceId`. The read-resolver uses this to map old -> new while the
   * gate is on, and the backfill uses it for idempotency.
   */
  getFalCounterpartVoiceId(minimaxVoiceId: string): Promise<null | string>

  /**
   * Returns the stored provider for a voice clone, if any.
   * When multiple rows share the same voiceId, semantics match Prisma findFirst.
   */
  getProviderByVoiceId(voiceId: string): Promise<null | string>

  /**
   * The speaker embedding a `provider: 'qwen3'` voice is synthesized from, or null
   * when the voice is not a Qwen3 voice or has no embedding.
   */
  getQwen3Speaker(voiceId: string): Promise<null | Qwen3SpeakerRecord>
}

// getTtsRecordByVoiceId and UserVoiceCloneTtsRecord were removed with the
// BytePlus clone path. Their only caller resolved `originalSource` into base64 reference
// audio for zero-shot synthesis; provider routing needs nothing but the provider itself,
// so the TTS path no longer reads the raw-sample pointer at all.
