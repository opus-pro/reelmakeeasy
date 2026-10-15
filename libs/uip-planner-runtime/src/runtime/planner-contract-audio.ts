import { PlannerToolCall, SessionState, TodoExecutorHint } from '../types'

import { PlannerOutputLike } from './runtime.types'

/**
 * Heuristic guard catching ASK_CLARIFY about duration in audio mode. Mirrors
 * the audio-mode shortcut in MODE_CONFIRMATION_FRAGMENT (unified-planner-prompt)
 * as a runtime belt-and-suspenders. Fires on duration cues in reply text
 * (how long / duration / video length / run for) or option labels matching
 * `<number><unit>` (30 seconds, 1 minute, 90s, etc.).
 */
export function checkAudioModeDurationAskGuard(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  if (
    session.spec.meta.audio_source !== 'user_audio' ||
    session.todo_state.phase !== 'mode_confirmation' ||
    output.action !== 'ASK_CLARIFY'
  ) {
    return null
  }

  const replyHasDurationCue =
    /\b(how|what)\s+long\b|\bduration\b|\bvideo\s+length\b|\brun\s+(for|time)\b/i.test(
      output.reply ?? '',
    )

  const optionLabelMatchesDuration = (output.options ?? []).some((option) =>
    /\b\d+\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|hour|hours)\b/i.test(
      option.label ?? '',
    ),
  )

  if (replyHasDurationCue || optionLabelMatchesDuration) {
    return (
      'ASK_CLARIFY in audio mode (audio_source=user_audio, phase=mode_confirmation) ' +
      'must not ask the user about duration. The uploaded audio length is the ' +
      'authoritative duration; runtime backfills mode_state.duration_seconds from ' +
      'audio metadata. Ask only about mode (when M is false) or emit MODE_CONFIRMED ' +
      '(when M is true).'
    )
  }

  return null
}

/**
 * Audio sessions take their script from the uploaded audio: the pre-voiceover
 * child seeds working_script (ASR transcript, or a music planning script for
 * instrumental tracks) and the phase advances off that seed. The planner must
 * never self-generate the script via generate_explainer_script -- a self-call
 * short-circuits to an EMPTY working_script that "succeeds" and used to advance
 * bootstrap_script -> script_review with no script, stranding the auto-continue
 * with "Cannot continue: no script available yet". This is the deterministic
 * backstop for the prompt's soft instruction; it covers every phase and both
 * single + batch tool calls (the only execution path for the tool).
 */
export function checkAudioSelfScriptToolCall(
  session: SessionState,
  toolCalls: null | PlannerToolCall[] | undefined,
): null | string {
  if (session.spec.meta.audio_source !== 'user_audio') {
    return null
  }
  if (toolCalls?.some((toolCall) => toolCall.tool === 'generate_explainer_script')) {
    return (
      'Audio sessions take the script from the uploaded audio (ASR transcript / ' +
      'music planning script). Do not call generate_explainer_script -- the phase ' +
      'advances automatically once the working_script is seeded, or the session ' +
      'fails if the audio cannot be processed.'
    )
  }
  return null
}

/**
 * The same audio invariant for pending directives: a directive whose TOOL_CALLS
 * executor_hint targets generate_explainer_script can never execute (the guard
 * above rejects it at run time), so it would strand as a permanently-pending
 * directive that never reconciles to done. Reject it at planning time too.
 */
export function checkAudioDirectiveScriptHint(
  session: SessionState,
  items: Array<{ executor_hint?: null | TodoExecutorHint; id: string }>,
): null | string {
  if (session.spec.meta.audio_source !== 'user_audio') {
    return null
  }
  for (const item of items) {
    const hint = item.executor_hint
    if (
      hint?.executor_type === 'TOOL_CALLS' &&
      hint.executor_tool === 'generate_explainer_script'
    ) {
      return `Audio sessions cannot use generate_explainer_script; remove the executor_hint on pending directive '${item.id}' -- the script comes from the uploaded audio.`
    }
  }
  return null
}
