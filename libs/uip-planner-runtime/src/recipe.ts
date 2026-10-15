import { ArtifactKey, getToolManifest } from './tool-manifest'
import { Mode, PlannerToolCall } from './types'

export interface ModeRecipe {
  mode: 'explainer'
  stages: ModeRecipeStage[]
}

export interface ModeRecipeStage {
  id: RecipeStageId
  produces: ArtifactKey
  requires: ArtifactKey[]
  tool: PlannerToolCall['tool']
}

export type RecipeStageId =
  | 't0_assets'
  | 't1_intent_context'
  | 't2_script'
  | 't3_vs'
  | 't4_anchor_assets'
  | 't_brand'

const EXPLAINER_STAGE_TOOLS: Array<{ id: RecipeStageId; tool: PlannerToolCall['tool'] }> = [
  { id: 't0_assets', tool: 'describe_uploaded_images' },
  { id: 't1_intent_context', tool: 'generate_intent_context' },
  { id: 't2_script', tool: 'generate_explainer_script' },
  { id: 't3_vs', tool: 'generate_explainer_visual_script' },
  { id: 't4_anchor_assets', tool: 'generate_anchor_assets' },
]

export const EXPLAINER_RECIPE: ModeRecipe = {
  mode: 'explainer',
  stages: EXPLAINER_STAGE_TOOLS.map((stage) => {
    const manifest = getToolManifest(stage.tool)
    return {
      id: stage.id,
      tool: stage.tool,
      requires: [...manifest.requires],
      produces: manifest.produces,
    }
  }),
}

const RECIPE_STAGE_BY_TOOL = new Map(
  EXPLAINER_RECIPE.stages.map((stage) => [stage.tool, stage] as const),
)

export function getModeRecipe(mode: Mode | null): ModeRecipe {
  if (mode !== 'explainer' && mode !== null) {
    return EXPLAINER_RECIPE
  }
  return EXPLAINER_RECIPE
}

export function getRecipeStageByTool(tool: PlannerToolCall['tool']): ModeRecipeStage {
  return RECIPE_STAGE_BY_TOOL.get(tool) ?? buildFallbackStage(tool)
}

function buildFallbackStage(tool: PlannerToolCall['tool']): ModeRecipeStage {
  const manifest = getToolManifest(tool)
  return {
    id: 't1_intent_context',
    tool,
    requires: [...manifest.requires],
    produces: manifest.produces,
  }
}
