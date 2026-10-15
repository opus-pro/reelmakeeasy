// Human-readable substep catalog for the UIP-v2 subTools progress display.
//
// SUBSTEP_DESCRIPTIONS maps every substep name a tool can report to a short,
// user-facing sentence. ALWAYS_SUBSTEPS lists the substeps a tool ALWAYS runs,
// so the fold can predeclare them as `not_started` the moment the tool starts
// (giving the FE a stable, complete checklist up front). Conditional substeps
// (e.g. length_rewrite_llm, style_analysis, beat_sheet, world_bible) are
// deliberately absent from ALWAYS_SUBSTEPS: they only appear in the subTools map
// once their first `running` tick arrives, so the checklist never shows a step
// that will not run this session.
//
// Pure constants + one lookup helper -- no runtime/workflow imports -- so this is
// safe to reach from both the activity-side fold and the API layer.

export const SUBSTEP_DESCRIPTIONS: Record<string, string> = {
  anchor_plan_llm: 'Planning recurring characters and objects',
  beat_sheet: 'Breaking the script into story beats',
  brand_styling: 'Deriving visual styling from your brand',
  extractor_llm: 'Extracting the script from your message',
  image_gen: 'Generating anchor images',
  intent_llm: 'Analyzing your request to draft the creative brief',
  length_rewrite_llm: 'Trimming the script to fit the target length',
  main_llm: 'Writing the video script',
  main_vs_llm: 'Directing the shot-by-shot visual script',
  prompt_route: 'Choosing the visual generation approach',
  prompt_specs: 'Writing image prompts for each anchor',
  style_analysis: 'Analyzing the style reference image',
  world_bible: 'Building the visual world guide',
}

export const ALWAYS_SUBSTEPS: Record<string, readonly string[]> = {
  anchor_vs_batch: ['anchor_plan_llm', 'prompt_specs', 'image_gen', 'prompt_route', 'main_vs_llm'],
  generate_anchor_assets: ['anchor_plan_llm', 'prompt_specs', 'image_gen'],
  generate_explainer_script: ['main_llm'],
  generate_explainer_visual_script: ['prompt_route', 'main_vs_llm'],
  generate_intent_context: ['intent_llm'],
}

/** Description for a substep, falling back to the raw name for unknown steps. */
export function describeSubstep(substep: string): string {
  return SUBSTEP_DESCRIPTIONS[substep] ?? substep
}
