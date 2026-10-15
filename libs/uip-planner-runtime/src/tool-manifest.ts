import { PlannerToolCall, Spec } from './types'

export type ArtifactKey =
  | 'anchor_assets'
  | 'asset_assignment_plan'
  | 'asset_descriptions'
  | 'brand_bank'
  | 'global_constraints'
  | 'script'
  | 'uploaded_assets'
  | 'visual_script'

export type MapperName =
  | 'asset_assignment_to_ops'
  | 'global_constraints_to_ops'
  | 'script_to_ops'
  | 'visual_script_to_ops'

export interface ToolManifest {
  auto_apply?: ToolAutoApply
  /**
   * Spec-dependent dependencies in addition to `requires`. Returned keys are
   * merged with `requires` at dependency-check time. Used for opt-in
   * dependencies that only apply under certain spec states (e.g.
   * `brand_bank` is required for `generate_explainer_script` once the
   * planner has set `brand_extraction_input` -- defense-in-depth so the
   * tool blocks even if the workflow gate is bypassed).
   */
  conditionalRequires?: (spec: Spec) => ArtifactKey[]
  name: PlannerToolCall['tool']
  produces: ArtifactKey
  requires: ArtifactKey[]
}

interface ToolAutoApply {
  enabled: boolean
  mapper: MapperName
}

const TOOL_MANIFESTS: Record<PlannerToolCall['tool'], ToolManifest> = {
  describe_uploaded_images: {
    name: 'describe_uploaded_images',
    requires: ['uploaded_assets'],
    produces: 'asset_descriptions',
  },
  generate_anchor_assets: {
    name: 'generate_anchor_assets',
    requires: ['global_constraints', 'script'],
    produces: 'anchor_assets',
  },
  plan_asset_assignment: {
    name: 'plan_asset_assignment',
    requires: ['asset_descriptions', 'visual_script'],
    produces: 'asset_assignment_plan',
    auto_apply: {
      enabled: true,
      mapper: 'asset_assignment_to_ops',
    },
  },
  generate_intent_context: {
    name: 'generate_intent_context',
    requires: [],
    produces: 'global_constraints',
    auto_apply: {
      enabled: true,
      mapper: 'global_constraints_to_ops',
    },
  },
  generate_explainer_script: {
    name: 'generate_explainer_script',
    requires: ['global_constraints'],
    // Require brand_bank only when the user intended brand context AND the
    // extraction actually succeeded. F1 skip-on-failure (status === 'failed')
    // routes through bootstrap_script without brand_bank, so dropping the
    // requirement here unblocks script generation. 'pending' is treated as
    // still-required so the gate holds while extraction is in flight (the
    // workflow's post-turn hook will signal when it lands).
    conditionalRequires: (spec) =>
      spec.global_constraints.brand_extraction_input &&
      spec.global_constraints.brand_extraction_status !== 'failed'
        ? ['brand_bank']
        : [],
    produces: 'script',
    auto_apply: {
      enabled: true,
      mapper: 'script_to_ops',
    },
  },
  generate_explainer_visual_script: {
    name: 'generate_explainer_visual_script',
    requires: ['script', 'global_constraints'],
    produces: 'visual_script',
    auto_apply: {
      enabled: true,
      mapper: 'visual_script_to_ops',
    },
  },
  select_auto_style: {
    name: 'select_auto_style',
    // Ranks preset styles from the brief (topic/tone/genre) generate_intent_context
    // already wrote onto global_constraints, so it depends on that artifact
    // existing first.
    requires: ['global_constraints'],
    produces: 'global_constraints',
    auto_apply: {
      enabled: true,
      mapper: 'global_constraints_to_ops',
    },
  },
}

export function getToolManifest(tool: PlannerToolCall['tool']): ToolManifest {
  return TOOL_MANIFESTS[tool]
}
