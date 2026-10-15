import { buildContextPayload } from '../context-builder'
import { projectAssetDescriptionsForPlanning } from '../tool-internals/asset-description-projection'
import { SessionState } from '../types'

export function buildDirectivesExtractionInput(session: SessionState, userMessage: string): string {
  const context = buildContextPayload(session, userMessage, {
    step_index: 0,
    max_steps: 0,
    last_action_result: 'n/a',
  })

  const recentTurns = context.conversation.recent_turns
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Agent'}: ${turn.content}`)
    .join('\n')

  return [
    'Pinned user prompt (preserve intent):',
    context.conversation.pinned_user_prompt || '(not available)',
    '',
    'Recent conversation:',
    recentTurns || '(none)',
    '',
    'Latest user message (incremental update):',
    userMessage.trim(),
  ].join('\n')
}

export function getAssetContextLightJson(session: SessionState, userMessage: string): string {
  const context = buildContextPayload(session, userMessage, {
    step_index: 0,
    max_steps: 0,
    last_action_result: 'n/a',
  })
  const light = context.runtime.asset_context_light
  // Drop the copied `asset_catalog[].summary`: it duplicates the per-asset
  // summary the same intent prompt already receives via assetDescriptionsJson
  // (and is '' before describe runs). asset_id / file_name / content_type stay
  // -- they are the only asset identity signal before describe has persisted
  // descriptions.
  return JSON.stringify(
    {
      ...light,
      asset_catalog: light.asset_catalog.map((entry) => ({
        asset_id: entry.asset_id,
        content_type: entry.content_type,
        file_name: entry.file_name,
        identity_clarity: entry.identity_clarity,
      })),
    },
    null,
    2,
  )
}

export function getAssetDescriptionsJson(session: SessionState): string {
  const artifact = session._loaded_asset_descriptions
  // Keep today's null branch EXACTLY: a bare `{ items: [] }` with no
  // `generated_at`. Routing it through the projection would need that key
  // invented, which would change every prompt for every session
  // before describe runs.
  if (!artifact) {
    return JSON.stringify({ items: [] }, null, 2)
  }
  // Project here, not at each prompt site. This accessor is the one
  // funnel every NARRATIVE PLANNING serialisation passes through (directives
  // extraction, asset context, and the planning prompts built from
  // session._loaded_asset_descriptions). It is not the only place
  // `AssetDescriptionItem` data gets serialised: anchor-generation.ts,
  // anchor-prompt-spec-builder.ts, and plan-asset-assignment.ts read the
  // unprojected item directly and deliberately.
  return JSON.stringify(projectAssetDescriptionsForPlanning(artifact), null, 2)
}
