import type { AgentMotionTask, AgentMotionTaskId } from '@shared/types/api/agent'

/** A Motion Reel's phases, in the order the agent goes through them, with their row names. */
export const MOTION_TASKS: readonly { id: AgentMotionTaskId; label: string }[] = [
  { id: 'setup', label: 'Set up' },
  { id: 'music', label: 'Music' },
  { id: 'plan', label: 'Plan' },
  { id: 'build', label: 'Build' },
  { id: 'look', label: 'Look (stills)' },
  { id: 'render', label: 'Render' },
  { id: 'sync', label: 'Sync check' },
  { id: 'review', label: 'Review' },
]

/** A Claude Animation's phases (it shows in the same Tasks panel), in order, with their names. */
export const ANIMATION_TASKS: readonly { id: AgentMotionTaskId; label: string }[] = [
  { id: 'setup', label: 'Set up' },
  // Only a Talking head has this row: Claude draws the avatar from a photo, or uses a saved one.
  { id: 'avatar', label: 'Avatar' },
  { id: 'plan', label: 'Plan' },
  { id: 'voice', label: 'Voices' },
  { id: 'music', label: 'Music' },
  { id: 'build', label: 'Build' },
  { id: 'look', label: 'Look (stills)' },
  { id: 'render', label: 'Render' },
  { id: 'review', label: 'Review' },
]

/** An animation's rows: the Avatar row only for a Talking head. */
export function animationTaskRows(
  talkingHead: boolean,
): readonly { id: AgentMotionTaskId; label: string }[] {
  return talkingHead ? ANIMATION_TASKS : ANIMATION_TASKS.filter((t) => t.id !== 'avatar')
}

/** Every animation phase still to come (before the setup: the look isn't known yet). */
export function waitingAnimationTasks(talkingHead = false): AgentMotionTask[] {
  return animationTaskRows(talkingHead).map(({ id, label }) => ({
    id,
    label,
    result: null,
    state: 'waiting',
  }))
}

/** How many renders the motion-reel skill allows before the agent says what is still off. */
export const MOTION_MAX_RENDERS = 3

/** Every phase still to come: what the Tasks panel shows before ReelMakeEasy sends the first list. */
export function waitingMotionTasks(): AgentMotionTask[] {
  return MOTION_TASKS.map(({ id, label }) => ({ id, label, result: null, state: 'waiting' }))
}
