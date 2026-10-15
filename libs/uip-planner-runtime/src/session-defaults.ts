import type {
  GlobalConstraints,
  Meta,
  PlannerTodoState,
  SessionBootstrapState,
  Spec,
  VisualScript,
} from './types'

export function buildEmptyBootstrapState(): SessionBootstrapState {
  return {
    remix_context: null,
    seed_style_instruction: null,
  }
}

export function buildEmptySpec(): Spec {
  const global_constraints: GlobalConstraints = {
    video_type: '',
    topic: '',
    key_entities: [],
    geo_scope: '',
    time_scope: '',
    brand_scope: '',
    target_audience: '',
    tone: '',
    style: {
      style_name: '',
      style_text: '',
      style_thumbnail_url: '',
    },
    pacing: null,
    directives: [],
    must_not_violate: [],
    brand_extraction_input: null,
    brand_extraction_status: null,
    brand_extraction_failure_reason: null,
    brand_extraction_started_at: null,
    brand_extraction_run_id: null,
    brand_extraction_retry_count: 0,
    brand_source_change_count: 0,
    brand_reextraction_pending: false,
    brand_extraction_declined: false,
    brand_bank: null,
    brand_bank_source: null,
    brand_bank_locked_at: null,
    brand_style_directive: null,
    brand_style_text: null,
    brand_style_preview_url: null,
    brand_video_type: null,
    brand_carry_state: null,
  }

  const visual_script: VisualScript = {
    shots: [],
  }

  const meta: Meta = {
    spec_version: 0,
    locked_at: null,
    mode_state: {
      mode: null,
      confirmed: false,
      duration_seconds: null,
      input_type: null,
      brand_intent_pending: false,
    },
    auto_lock_deadline_at: null,
    blocking: true,
    open_questions: [],
    audio_source: null,
    script_word_cap: null,
    consistency_guard_enabled: false,
    improved_visual_script_enabled: false,
    story_mode_v3_enabled: false,
    music_video_improvement_enabled: false,
    is_music: false,
    transcript_voice_preview_enabled: false,
  }

  return { global_constraints, visual_script, meta }
}

export function buildEmptyTodoState(): PlannerTodoState {
  return {
    phase: 'mode_confirmation',
    items: [],
  }
}
