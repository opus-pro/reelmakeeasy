/**
 * User-facing vocabulary for runtime-generated replies.
 *
 * Runtime code must never surface internal tool / mode identifiers to the
 * user. When we need to describe an activity or a mode in a hard-coded
 * reply, route it through these helpers so the wording stays consistent
 * with the planner-prompt Reply Style section.
 */

import { MODE_CONFIRMED_FOLLOWUP_MESSAGE } from '@reelmakeeasy/common/uip-runtime-messages'

import type { PatchOp, SessionState } from '../types'

const TOOL_ACTIVITY: Record<string, string> = {
  describe_uploaded_images: 'looking at your uploaded images',
  generate_anchor_assets: 'making your custom assets',
  generate_explainer_script: 'writing your script',
  generate_explainer_visual_script: 'designing your storyboard',
  generate_intent_context: 'putting your video brief together',
  plan_asset_assignment: 'placing your images into the storyboard',
}

/**
 * Turn an internal tool id (e.g. `generate_intent_context`) into a short
 * user-facing activity phrase suitable for a progress reply
 * ("I'm {describeToolActivity(tool)}...").
 *
 * Unknown tool ids fall back to a generic phrase so we never leak raw
 * snake_case names to the user.
 */
export function describeToolActivity(tool: string): string {
  return TOOL_ACTIVITY[tool] ?? 'working on your video plan'
}

const MODE_LABEL: Record<string, string> = {
  ads: 'ad',
  explainer: 'explainer video',
  narrative_story: 'narrative story',
}

/**
 * Turn an internal mode id into a user-facing label for reply text.
 */
export function describeMode(mode: null | string | undefined): string {
  if (!mode) {
    return 'video'
  }
  return MODE_LABEL[mode] ?? 'video'
}

const TOOL_COMPLETION: Record<string, string> = {
  describe_uploaded_images: 'I finished looking at your uploaded images.',
  generate_anchor_assets: 'Your custom assets are ready.',
  generate_explainer_script: 'Your script is ready.',
  generate_explainer_visual_script: 'Your storyboard is ready.',
  generate_intent_context: 'Your video brief is ready.',
  plan_asset_assignment: 'I placed your images into the storyboard.',
}

/**
 * Turn an internal tool id into a user-facing "done" phrase for the
 * post-tool acknowledgment reply ("I just finished X"). Paired with
 * `describeToolActivity` which handles the pre-tool "I'm doing X" reply.
 */
export function describeToolCompletion(tool: string): string {
  return TOOL_COMPLETION[tool] ?? 'Done.'
}

/**
 * Gate the post-tool "done" acknowledgment reply. Returns false when the
 * tool ran but produced nothing the user should be told about, so callers
 * skip `appendProgressReply` and the user does not see a misleading
 * confirmation for a no-op tool execution.
 *
 * Currently only `generate_anchor_assets` has a no-op shape: the tool can
 * run with empty `anchor_requests` (or be invoked when no anchors are
 * actually planned) and return successfully with `ready_count = 0`. In
 * that case "Your custom assets are ready." is a lie -- there are no
 * custom assets.
 *
 * Other tools either always produce output on success (script / VS /
 * intent context) or short-circuit before the success path (audio mode
 * skips generate_explainer_script entirely), so they default to true.
 */
export function describeAnchorPlanReadyMilestone(): string {
  return "I've mapped out your custom assets. Now generating reference images..."
}

/**
 * Hardcoded follow-up reply emitted by the runtime immediately after the
 * planner's MODE_CONFIRMED reply. Tells the user (a) the agent is now
 * autonomously building the video, and (b) they can either keep refining
 * or step away and let the agent finish via the auto-lock deadline.
 *
 * Kept separate from the planner's own reply because the planner-prompt
 * does not know about the auto-lock UX behaviour -- this is a runtime-
 * level invariant. Centralised here so wording stays consistent with the
 * rest of the user-facing vocab.
 */
export function describeModeConfirmedFollowupReply(): string {
  return MODE_CONFIRMED_FOLLOWUP_MESSAGE
}

/**
 * Post-VS user-facing milestone reply.
 *
 * FULL scope (re-segment / first design / structure-edit merged-back path)
 * is described as a fresh storyboard design. Partial scopes (SHOT_IDS /
 * SHOT_RANGE) only regenerated the named shots -- the storyboard total is
 * unchanged -- so the wording must say "updated N shots" rather than
 * "designed your storyboard (N shots)", which previously read as if the
 * whole storyboard had been rewritten down to N shots. See
 * `tool-runtime.ts` post-VS reply path.
 */
export function describeShotsMilestone(shotCount: number, scope: string): string {
  if (scope === 'SHOT_IDS' || scope === 'SHOT_RANGE') {
    return `I've updated ${shotCount} ${shotCount === 1 ? 'shot' : 'shots'} in your storyboard.`
  }
  return `I've designed your storyboard (${shotCount} shots).`
}

export function shouldEmitToolCompletionReply(tool: string, session: SessionState): boolean {
  if (tool === 'generate_anchor_assets') {
    const readyCount = session.cached_artifacts.anchor_assets_summary?.ready_count ?? 0
    return readyCount > 0
  }
  return true
}

/**
 * Stable canonical ordering for user-facing artifact names so the
 * summary sentence reads the same regardless of how patch ops happen to
 * be ordered by the planner.
 */
const PATCH_ARTIFACT_ORDER: ReadonlyArray<string> = ['script', 'video brief', 'storyboard']

/**
 * Turn a list of `PatchOp` into a user-facing "I updated your X" summary
 * used as the post-patch reply fallback when the planner did not supply
 * its own `output.reply`. Maps every patch-op variant onto one of the
 * high-level artifacts users recognise (script / video brief /
 * storyboard) and joins them naturally.
 */
export function describePatchOpsForUser(ops: PatchOp[]): string {
  const touched = new Set<string>()
  for (const op of ops) {
    switch (op.op) {
      case 'add_preselected_asset':
      case 'delete_shots':
      case 'remove_preselected_asset':
      case 'reorder_shots':
      case 'replace_all_shots':
      case 'replace_shots_range':
      case 'retime_shot': {
        touched.add('storyboard')
        break
      }
      case 'update_global_field': {
        touched.add('video brief')
        break
      }
      case 'update_shot_field': {
        touched.add(op.field === 'audio_vo' ? 'script' : 'storyboard')
        break
      }
    }
  }
  if (touched.size === 0) {
    return 'I updated your video plan.'
  }
  const ordered = PATCH_ARTIFACT_ORDER.filter((name) => touched.has(name))
  return `I updated your ${joinNaturalEnglish(ordered)}.`
}

function joinNaturalEnglish(parts: ReadonlyArray<string>): string {
  if (parts.length === 0) {
    return ''
  }
  if (parts.length === 1) {
    return parts[0] ?? ''
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`
  }
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}
