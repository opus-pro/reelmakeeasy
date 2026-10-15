import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { z } from 'zod'

import { PLANNER_TOOL_MODELS_LIGHT } from '../model-config'
import { synthesizeBrandAssetId } from '../tool-internals/brand-staged-assets-to-uploads'
import { parseConversationContext } from '../tool-internals/conversation-context'
import { AssetAssignmentPlanArtifact, AssetDescriptionItem, BrandBank, Shot } from '../types'

const logger = createSubLogger('uip-planner-runtime:plan-asset-assignment')

/**
 * Project each shot down to the fields the assignment planner actually reads:
 * its id, the `core_description` it matches entities against, and the current
 * `pre_selected_assets` it revises. The full `Shot` also carries `audio_vo`,
 * the rest of `visual_primary`, and timing -- none of which this tool touches
 * (the prompt explicitly does not rewrite audio_vo / visual_primary), so
 * dropping them cuts input tokens with no decision-relevant loss.
 */
export function projectShotsForAssetAssignment(shots: Shot[]): Array<{
  core_description: string
  pre_selected_assets: Shot['pre_selected_assets']
  shot_id: string
}> {
  return shots.map((shot) => ({
    core_description: shot.visual_primary.core_description,
    pre_selected_assets: shot.pre_selected_assets,
    shot_id: shot.shot_id,
  }))
}

/**
 * Project the upload catalog down to the fields the assignment planner uses to
 * pick an asset: id + file_name + one-line `summary` + `entities` + the full
 * `description`, plus `brand_asset_kind` for brand routing. `description` is
 * kept because it is the only field carrying the concrete visual detail (color,
 * printed text, material) that disambiguates two uploads sharing a generic
 * summary/entities on a routing turn ("use the red one on shot 3"). Drops the
 * remaining describe-only fields (tags / usage_guidance / quality /
 * content_type / file_path), which the assignment prompt never consults.
 */
export function projectAssetDescriptionsForAssetAssignment(
  items: AssetDescriptionItem[],
): Array<
  Pick<
    AssetDescriptionItem,
    'asset_id' | 'brand_asset_kind' | 'description' | 'entities' | 'file_name' | 'summary'
  >
> {
  return items.map((item) => ({
    asset_id: item.asset_id,
    brand_asset_kind: item.brand_asset_kind ?? null,
    description: item.description,
    entities: item.entities,
    file_name: item.file_name,
    summary: item.summary,
  }))
}

const AssetAssignmentActionSchema = z.object({
  op: z.enum(['ADD', 'REMOVE']),
  shot_id: z.string().trim().min(1),
  asset_id: z.string().trim().min(1),
  asset_source: z.enum(['anchor_asset', 'user_upload']),
  usage: z.string().trim().default('primary anchor'),
  reason: z.string().trim().min(1),
})

const AssetAssignmentPlanSchema = z.object({
  actions: z.array(AssetAssignmentActionSchema).default([]),
})

const PLAN_ASSET_ASSIGNMENT_PROMPT = `Role:
You are a shot-level asset assignment planner.

Goal:
Based on user intent, decide explicit pre_selected_assets ADD / REMOVE operations for the current visual script. The visual-script tool already runs an Asset binding pass when shots are generated; your job is to REVISE that binding when the user's intent implies explicit asset routing changes (e.g. "best use this image", "put the logo on shot 3 too", "remove that character from the opening").

Asset Source Preference (HARD):
- source="anchor_asset" is the DEFAULT for recurring continuity subjects (canonicalized characters or recurring props). Anchor binding is how UIP enforces cross-shot visual consistency.
- source="user_upload" is ONLY appropriate when:
  (a) the upload was not absorbed into any anchor (residual direct-use asset), OR
  (b) the user explicitly wants the raw uploaded image itself as the visual reference for a specific shot.
- Do NOT emit ADD with source="user_upload" for an upload that already has a matching entity in Current Anchor Assets — use source="anchor_asset" with that anchor_id instead.

Identity Priority (HARD):
- If a shot's core_description mentions a specific \`proper_name\` that equals any anchor's \`proper_name\` in Current Anchor Assets, you MUST emit an ADD op binding that anchor_asset to that shot (unless the assignment already exists in the shot's pre_selected_assets).
- Example: shot says "Elon Musk walks on stage" and anchor \`char_elon_musk\` has proper_name="Elon Musk" → ADD anchor_asset char_elon_musk.

Recurring Entity Rule (HARD):
- For each anchor in Current Anchor Assets, check whether any shot's core_description depicts that anchor's entity. Match using (in priority order): \`proper_name\`, \`visual_tag\`, \`keyword\`, or \`label\`.
- If a shot clearly depicts the entity but the anchor is NOT yet in that shot's pre_selected_assets, emit an ADD op.
- This is how UIP enforces visual consistency across shots — recurring entities must share the same anchor_asset across shots.

Attachment Discipline (HARD):
- Only emit ADD when the asset is the shot's genuine visual subject or visual anchor. Do NOT:
  - attach an anchor to every shot just because it exists
  - attach an upload to a shot that does not visually feature it
  - add assignments for continuity / narration shots where no specific subject is depicted
- If no asset change is required, return actions: [] — empty is a valid, expected output.

Default Coverage Policy (UIP-specific):
1) User explicit instruction has the highest priority for assignment scope.
2) Default: one uploaded asset maps to one primary shot (avoid repeated cross-shot reuse of the same upload unless required).
3) Allow cross-shot reuse of the same asset only when:
   - the visual script is a continuous story line and the asset acts as a cross-shot anchor, or
   - the user explicitly requests multi-shot assignment.
4) Avoid assigning multiple uploaded assets to a single shot by default.
5) Assign multiple assets to one shot only when that shot's core_description clearly requires all of them.

Operational Rules (HARD):
- Only output operations that change pre_selected_assets. Do not rewrite audio_vo or visual_primary.
- Every action must target an existing shot_id and an existing asset_id from the provided inputs.
- For REMOVE, only remove assignments that currently exist for the same (asset_source, asset_id) pair on that shot.
- For ADD, avoid duplicate assignment of the same (asset_source, asset_id) pair to the same shot.
- Prefer minimal changes: emit only the ops actually needed to satisfy the user's intent and the HARD rules above.

Input:
- Latest user message, recent conversation context, pinned user prompt (user intent signals).
- Full visual script shots JSON (current per-shot core_description + current pre_selected_assets).
- Full asset descriptions JSON (user-uploaded asset catalog).
- Current Anchor Assets JSON (each anchor carries metadata):
  - \`anchor_id\` — stable id to use as asset_id when source="anchor_asset"
  - \`label\` — human-readable short label
  - \`visual_tag\` — 3-word functional identifier (e.g. "Male Athletic Runner")
  - \`keyword\` — "The <X>" short label (e.g. "The Runner")
  - \`proper_name\` — specific named entity (person / brand / product) or null
  - \`is_multi_angle\` — boolean; this anchor is one view of a multi-view set (sibling anchor_ids carry other views)
  - \`passthrough\` — boolean; anchor image is the user's raw upload (logo/icon), functionally interchangeable with a generated anchor for routing purposes
  - \`source_asset_ids\` — upload ids this anchor is derived from
  - \`status\` — "ready" | "planned" | "generating" | "failed"

Output Contract:
Return JSON only:
{
  "actions": [
    {
      "op": "ADD | REMOVE",
      "shot_id": "shot_N",
      "asset_id": "anchor_id_or_upload_asset_id",
      "asset_source": "anchor_asset | user_upload",
      "usage": "short usage text",
      "reason": "one-sentence reason grounded in a specific rule above or a specific user instruction"
    }
  ]
}
`

export async function planAssetAssignment(params: {
  anchorAssetsJson: string
  assetDescriptionsJson: string
  /**
   * Optional Tier 1 brand bank. When present, a BRAND ASSET PREFERENCE
   * block is appended to the prompt so the LLM prefers brand-staged
   * assets (logos, products, characters) over generic uploads for shots
   * that mention the brand or its offerings. Null on non-brand sessions;
   * the block is left out in that case.
   */
  brandBank?: BrandBank | null
  conversationContext: string
  visualScriptJson: string
}): Promise<AssetAssignmentPlanArtifact> {
  const parsedContext = parseConversationContext(params.conversationContext)
  const brandPreferenceSection = renderBrandAssetPreferenceSection(params.brandBank ?? null)
  const prompt = `${PLAN_ASSET_ASSIGNMENT_PROMPT}

Latest User Message:
${parsedContext.latestUserMessage}

Recent Conversation Context:
${parsedContext.recentConversationContext}

Pinned Raw User Prompt:
${parsedContext.pinnedRawUserPrompt}

Full Visual Script Shots JSON:
${params.visualScriptJson}

Full Asset Descriptions JSON:
${params.assetDescriptionsJson}

Current Anchor Assets JSON:
${params.anchorAssetsJson}
${brandPreferenceSection}`

  logger.info(`[uip-plan-asset-assignment] start promptChars=${prompt.length}`)
  const startedAt = Date.now()

  const result = await completion({
    models: PLANNER_TOOL_MODELS_LIGHT,
    prompt,
    responseFormat: AssetAssignmentPlanSchema,
    reasoningEffort: 'low',
    temperature: 0.1,
    task: 'user-intent-planner-plan_asset_assignment',
    timeout: 30_000,
  })

  logger.info(
    `[uip-plan-asset-assignment] done durationMs=${Date.now() - startedAt} actions=${result.actions.length}`,
  )

  return {
    generated_at: new Date().toISOString(),
    actions: result.actions.map((action) => ({
      op: action.op,
      shot_id: normalizeAssetAssignmentShotId(action.shot_id),
      asset_id: action.asset_id,
      asset_source: action.asset_source,
      usage: action.usage || 'primary anchor',
      reason: action.reason,
    })),
  }
}

function normalizeAssetAssignmentShotId(shotId: string): string {
  const normalized = shotId.trim()
  const shotMatch = normalized.match(/^shot_(\d+)(?:\D.*)?$/i)
  if (shotMatch) {
    return `shot_${Number.parseInt(shotMatch[1], 10)}`
  }

  const shortMatch = normalized.match(/^s(\d+)$/i)
  if (shortMatch) {
    return `shot_${Number.parseInt(shortMatch[1], 10)}`
  }

  return normalized
}

function renderBrandAssetPreferenceSection(brandBank: BrandBank | null): string {
  if (!brandBank) {
    return ''
  }
  const businessName = brandBank.basic_info.business_name
  const offeringKeys = Object.keys(brandBank.product_offerings)
  const offeringKeysLine = offeringKeys.length > 0 ? offeringKeys.join(', ') : '(none)'

  const renderBucket = (
    label: 'character' | 'logo' | 'product',
    refs: BrandBank['staged_assets']['logo'],
  ): string => {
    if (refs.length === 0) {
      return `- ${label}: (none)`
    }
    // Asset_ids MUST match what `brandStagedAssetsToUploads` synthesizes;
    // otherwise the LLM's ADD ops reference asset_ids that do not appear
    // in Uploaded Assets JSON.
    const ids = refs.map((ref) => synthesizeBrandAssetId(ref.staging_uri, label)).join(', ')
    return `- ${label}: ${ids}`
  }

  return `
BRAND ASSET PREFERENCE (HARD when applicable):
The user is making a video for the brand "${businessName}". Brand-supplied assets are staged in three buckets. When a shot's core_description mentions the brand by name, or one of its product/offering keys, prefer the matching brand-staged asset over generic uploads.
Trigger words (any of these in a shot's core_description signals brand context):
- business name: ${businessName}
- product / offering keys: ${offeringKeysLine}
Brand-staged asset IDs (use these as asset_id with the matching asset_source when emitting an ADD op):
${renderBucket('logo', brandBank.staged_assets.logo)}
${renderBucket('product', brandBank.staged_assets.product)}
${renderBucket('character', brandBank.staged_assets.character)}
`
}
