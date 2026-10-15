import {
  buildLongTakeWorldBibleExpertPrompt,
  type WorldBibleUserAssetContext,
} from '@reelmakeeasy/common/long-take/prompts/long-take-world-bible-expert-prompt'

import type { GlobalConstraints, UipPromptRoute } from '../types'

export interface BuildWorldBibleExpertPromptParams {
  // When provided, the 8 duplicated global_context fields are treated as
  // already-resolved (authoritative) and the model is told NOT to re-derive or
  // emit them -- it outputs only `creative_guardrails` inside global_context.
  // The runtime populates the duplicated fields from these constraints.
  globalConstraints?: GlobalConstraints
  promptRoute?: UipPromptRoute
  script: string
  transitionVideoModel?: string
  userAssetContext: WorldBibleUserAssetContext
  userSimulationParameters?: string
}

export type { WorldBibleUserAssetContext }

export function buildWorldBibleExpertPrompt(params: BuildWorldBibleExpertPromptParams): string {
  const basePrompt = buildLongTakeWorldBibleExpertPrompt({
    promptRoute: params.promptRoute,
    script: params.script,
    transitionVideoModel: params.transitionVideoModel,
    userAssetContext: params.userAssetContext,
    userSimulationParameters: params.userSimulationParameters,
  })
  if (!params.globalConstraints) {
    return basePrompt
  }
  return `${basePrompt}\n\n${buildPredeterminedGlobalContextDirective(params.globalConstraints)}`
}

// Overrides the base prompt's Output Format for UIP: the 8 duplicated
// global_context fields are already resolved by generate_intent_context, so
// the model must NOT spend output tokens re-deriving them and must emit ONLY
// `creative_guardrails` inside global_context. The runtime fills the rest.
function buildPredeterminedGlobalContextDirective(gc: GlobalConstraints): string {
  const userConstraints = {
    directives: gc.directives ?? [],
    must_not_violate: gc.must_not_violate ?? [],
  }
  const userConstraintsBlock =
    userConstraints.directives.length > 0 || userConstraints.must_not_violate.length > 0
      ? `\n\nExplicit User Constraints (AUTHORITATIVE):
${JSON.stringify(userConstraints, null, 2)}

These requirements and prohibitions override creative harmonization, gap filling, and style choices. Preserve the requested use of uploaded assets and all specified placement, anatomy, actions, and exclusions. Keep creative_guardrails, thematic_core, visual_strategy, and world_physics consistent with these constraints; do not reinterpret an uploaded subject as a different prop or decorative motif against the user's requirements.`
      : ''
  const predetermined = {
    brand_scope: gc.brand_scope ?? '',
    geo_scope: gc.geo_scope ?? '',
    key_entities: gc.key_entities ?? [],
    script_category: gc.script_category ?? 'concept_centric',
    time_scope: gc.time_scope ?? '',
    tone: gc.tone ?? '',
    topic: gc.topic ?? '',
    video_type: gc.video_type ?? '',
  }
  return `Predetermined Global Context (AUTHORITATIVE — already resolved upstream; do NOT re-derive or output these):
${JSON.stringify(predetermined, null, 2)}

OUTPUT OVERRIDE (takes precedence over the Output Format above): inside "global_context" output ONLY "creative_guardrails" (3-6 constraints). Do NOT output video_type, script_category, topic, key_entities, geo_scope, time_scope, tone, or brand_scope — they are fixed above. Keep your creative_guardrails, thematic_core, visual_strategy, and world_physics consistent with the predetermined context.${userConstraintsBlock}`
}
