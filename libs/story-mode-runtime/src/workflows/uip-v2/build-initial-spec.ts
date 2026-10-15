import type { SessionState, UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'

/**
 * Build the initial spec (mirrors V1 buildEmptySpec + session-init overrides).
 * Constructed as a literal rather than via buildEmptySpec because that is a
 * VALUE export of @reelmakeeasy/uip-planner-runtime, which workflow code does not
 * value-import. Extracted from workflow.ts to keep that file under the max-lines cap.
 */
export function buildInitialSpec(params: UipSessionWorkflowParams): SessionState['spec'] {
  // Entry-point music declaration (song-to-video front door). Mirrors the V1
  // session-init pins; only meaningful for audio sessions.
  const isMusicAudioSession = params.isMusic === true && Boolean(params.audioPath)
  return {
    global_constraints: {
      // Saved-brief reuse: the brand bank arrives pre-populated. brand_extraction_input
      // stays null so no extraction child fires (the phase router reads this
      // seeded snapshot to route into an editable brand_review instead).
      brand_bank: params.savedBrandBrief?.bank ?? null,
      // A selected saved brief seeds an EDITABLE brand_review (status
      // 'completed', not pre-locked) so the user can review/edit it like a fresh
      // extraction; it locks on review exit.
      brand_bank_locked_at: null,
      brand_bank_source: params.savedBrandBrief
        ? {
            attached_via: params.savedBrandBrief.attachedVia,
            brief_id: params.savedBrandBrief.briefId,
            kind: 'brand_library' as const,
          }
        : null,
      // Brand-remix carry-over, staged for direct apply on turn 1. Mirrors the
      // V1 session-init seeding: status pending + applied_via null are
      // runtime-owned; carried_asset_keys ride in on params (computed
      // API-side). Null on non-brand-remix sessions.
      brand_carry_state: params.brandCarryState
        ? { ...params.brandCarryState, status: 'pending' as const, applied_via: null }
        : null,
      brand_extraction_failure_reason: null,
      brand_extraction_input: null,
      brand_extraction_run_id: null,
      brand_extraction_started_at: null,
      brand_extraction_status: params.savedBrandBrief ? ('completed' as const) : null,
      brand_extraction_retry_count: 0,
      brand_reextraction_pending: false,
      brand_extraction_declined: false,
      brand_scope: '',
      brand_source_change_count: 0,
      brand_style_directive: null,
      brand_style_text: null,
      brand_style_preview_url: null,
      brand_video_type: null,
      directives: [],
      geo_scope: '',
      key_entities: [],
      must_not_violate: [],
      pacing: null,
      style: {
        style_name: params.seedStyleInstruction?.style_name ?? '',
        style_text: params.seedStyleInstruction?.style_text ?? '',
        style_thumbnail_url: params.seedStyleInstruction?.style_thumbnail_url ?? '',
      },
      // Auto Style Selection (spec, "preset-only" V1). Snapshot of the
      // gate-checked style seed mode resolved at session creation; the API
      // layer already forces 'manual' when the gate is off, so this seeds
      // verbatim. Absent params.styleMode (pre-feature / legacy callers)
      // folds to 'manual'.
      style_mode: params.styleMode ?? 'manual',
      target_audience: '',
      time_scope: '',
      tone: '',
      topic: '',
      video_type: '',
    },
    meta: {
      auto_lock_deadline_at: null,
      audio_source: params.audioPath ? 'user_audio' : null,
      blocking: true,
      consistency_guard_enabled: params.consistencyGuardEnabled === true,
      improved_visual_script_enabled: params.improvedVisualScriptEnabled === true,
      story_mode_v3_enabled: params.storyModeV3Enabled === true,
      locked_at: null,
      music_video_improvement_enabled: params.musicVideoImprovementEnabled === true,
      transcript_voice_preview_enabled: params.transcriptVoicePreviewEnabled === true,
      is_music: isMusicAudioSession,
      // Creation tab the session was started from. Pass-through:
      // undefined on older params and tab-less sessions is dropped at
      // every serialization boundary, so persisted specs keep their original
      // shape (same treatment as autoContinueEnabled).
      entry_use_case: params.entryUseCase,
      // Tier-1 content detection (ID3 vendor tag). V1-parity pin; the
      // YAMNet/LLM fold is V1-only for now (V2 spec lives in planner
      // artifacts -- tracked with the other V2 music gaps).
      audio_is_music: Boolean(params.audioIsMusicVendorTag),
      mode_state: {
        brand_intent_pending: false,
        confirmed: false,
        // Null until the planner (or, for audio, the ASR backfill) fills it.
        duration_seconds: null,
        // Pre-seed the planner classification for declared-music sessions:
        // the mode_confirmed fold keeps an existing input_type (V1-parity
        // stickiness), so the entry-point declaration survives the planner's
        // own MODE_CONFIRMED classification.
        input_type: isMusicAudioSession ? 'audio_music' : null,
        mode: null,
      },
      open_questions: [],
      script_word_cap: null,
      spec_version: 0,
      // Per-session snapshot of the `auto_style_selection` feature gate
      // (spec, "preset-only" V1), pinned once by the API service at
      // session creation.
      auto_style_enabled: params.autoStyleEnabled === true,
      // Auto Style Selection ranking catalog (spec, Task 6B): seeded
      // verbatim from `params.styleCatalog`, which the API service only
      // resolves when the gate above is on (see resolveStyleCatalog / Task
      // 3's threading). Stays undefined on the gate-off / legacy path -- the
      // select_auto_style activity folds an absent catalog to `[]`.
      style_catalog: params.styleCatalog,
    },
    visual_script: { shots: [] },
  }
}
