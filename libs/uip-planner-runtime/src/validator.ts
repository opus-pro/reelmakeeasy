import { GlobalConstraints, OpenQuestion, Shot, Spec, ValidationResult } from './types'

/**
 * Deterministic spec validator.
 * Computes blocking status and open questions based on criticality policy v1.
 * LLM never overrides this output.
 */
export function validateSpec(spec: Spec): ValidationResult {
  const open_questions: OpenQuestion[] = []
  const warnings: string[] = []
  let idCounter = 1

  const addQuestion = (question: string, missing_paths: string[], blocking: boolean): void => {
    open_questions.push({
      id: `q${idCounter++}`,
      question,
      blocking,
      missing_paths,
    })
  }

  const gc = spec.global_constraints
  const vs = spec.visual_script
  const mode = spec.meta.mode_state?.mode ?? null

  // Critical global fields
  validateGlobalConstraints(gc, mode, addQuestion)

  // Critical VS fields
  if (!vs.shots || vs.shots.length === 0) {
    addQuestion(
      'No shots have been planned yet. Please describe the video content so I can generate shots.',
      ['visual_script.shots'],
      true,
    )
  } else {
    // Gated music sessions cut on the beat grid: instrumental intro/interlude/outro shots carry
    // an empty audio_vo by design. The exemption is per-shot -- only shots the
    // beat-locked normalization marked is_instrumental skip the check, so a lyric beat that
    // accidentally lost its voice-over is still flagged. Keyed on audio_source (not
    // mode_state.input_type): beat-locking follows the resolved music prompt route, which can
    // fire for 'audio_script' uploads too, and the route is not visible from the Spec alone.
    // is_instrumental is only ever stamped by the beat-locked normalization, so the per-shot
    // condition keeps the exemption tight.
    const allowSilentShots =
      spec.meta.audio_source === 'user_audio' && spec.meta.music_video_improvement_enabled === true
    for (const shot of vs.shots) {
      validateShot(shot, addQuestion, allowSilentShots && shot.is_instrumental === true)
    }

    // Time/ordering constraints
    validateShotTimingAndOrder(vs.shots, warnings)
  }

  const blocking = open_questions.some((q) => q.blocking)

  return { blocking, open_questions, warnings }
}

function validateGlobalConstraints(
  gc: GlobalConstraints,
  mode: Spec['meta']['mode_state']['mode'],
  addQuestion: (question: string, paths: string[], blocking: boolean) => void,
): void {
  if (!gc.topic?.trim()) {
    addQuestion(
      'What is the main topic or subject of this video?',
      ['global_constraints.topic'],
      true,
    )
  }

  // video_type is never hard-blocking: the brief prompt always infers a
  // best-effort type, and it is almost always derivable from the prompt. If it is
  // still empty the planner proceeds and the user can set it from the editable
  // brief -- downstream consumers default to '' gracefully, and ad routing keys off
  // mode_state.mode / brand_video_type, not this free-text field.
  if (!gc.video_type?.trim()) {
    addQuestion(
      'What type of video is this (e.g. educational, promotional, news)?',
      ['global_constraints.video_type'],
      false,
    )
  }

  // target_audience is blocking ONLY in ads mode, where the audience drives the
  // whole creative. For explainer / narrative_story (and pre-confirm
  // null mode) it is a soft field: the brief prompt infers a best-effort value
  // and the user can correct it, so an empty audience must not strand
  // bootstrap_script (the 06221113 ASK_CLARIFY -> PATCH_SPEC stall). The
  // discriminator is the structural mode_state.mode -- NOT the free-text
  // video_type (brittle to match, and now itself a soft/inferred field).
  if (!gc.target_audience?.trim()) {
    addQuestion(
      'Who is the target audience for this video?',
      ['global_constraints.target_audience'],
      mode === 'ads',
    )
  }
}

function validateShot(
  shot: Shot,
  addQuestion: (question: string, paths: string[], blocking: boolean) => void,
  allowSilentShot: boolean,
): void {
  if (!shot.shot_id) {
    addQuestion(
      `Shot at order ${shot.order} is missing a shot_id.`,
      [`visual_script.shots[${shot.order}].shot_id`],
      true,
    )
  }

  if (shot.time.start_s === undefined || shot.time.end_s === undefined) {
    addQuestion(
      `Shot ${shot.shot_id} is missing timing information.`,
      [`visual_script.shots.${shot.shot_id}.time`],
      true,
    )
  } else if (shot.time.end_s <= shot.time.start_s) {
    addQuestion(
      `Shot ${shot.shot_id} has invalid timing: end_s must be greater than start_s.`,
      [`visual_script.shots.${shot.shot_id}.time`],
      true,
    )
  }

  if (!shot.audio_vo?.trim() && !allowSilentShot) {
    addQuestion(
      `Shot ${shot.shot_id} is missing voice-over text.`,
      [`visual_script.shots.${shot.shot_id}.audio_vo`],
      true,
    )
  }

  if (!shot.visual_primary?.core_description?.trim()) {
    addQuestion(
      `Shot ${shot.shot_id} is missing a visual description.`,
      [`visual_script.shots.${shot.shot_id}.visual_primary.core_description`],
      true,
    )
  }
}

function validateShotTimingAndOrder(shots: Shot[], warnings: string[]): void {
  const sortedShots = [...shots].sort((a, b) => a.order - b.order)

  for (let i = 1; i < sortedShots.length; i++) {
    const prev = sortedShots[i - 1]
    const curr = sortedShots[i]

    if (curr.time.start_s < prev.time.start_s) {
      warnings.push(
        `Shots are not ordered by start time: shot ${prev.shot_id} (${prev.time.start_s}s) comes after shot ${curr.shot_id} (${curr.time.start_s}s).`,
      )
    }

    if (curr.time.start_s < prev.time.end_s) {
      warnings.push(
        `Shots overlap: ${prev.shot_id} ends at ${prev.time.end_s}s but ${curr.shot_id} starts at ${curr.time.start_s}s.`,
      )
    }
  }
}
