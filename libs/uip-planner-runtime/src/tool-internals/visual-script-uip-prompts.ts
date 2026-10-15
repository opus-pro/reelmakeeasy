import type {
  GlobalConstraints,
  PlannerStructureEdit,
  PlannerToolParams,
  Shot,
  UipPromptRoute,
} from '../types'

import { parseFullScopeBeatSheetMeta } from './full-scope-visual-script-normalization'
import {
  buildBrandLogoGuidance,
  extractAnchorConsumedSourceAssetIds,
  extractAnchorSourceAssetIdsByAnchorId,
  extractKnownAnchorIds,
  extractKnownAssetIds,
  extractUserUploadBrandAssetIds,
  filterAssetDescriptionsByBrandBank,
} from './visual-script-asset-ids'
import { renderVisualScriptRouteGuidance } from './visual-script-route-guidance'

const LONG_TAKE_VISUAL_SCRIPT_CONFIG = {
  baseline: {
    minWords: 6,
    maxWords: 12,
  },
}

type BuildUipVisualScriptPromptForScopeParams = {
  anchorAssetsJson: string
  assetDescriptionsJson: string
  /**
   * Required, not optional: an optional prompt input that silently defaults to
   * "{}" is how a past bug shipped -- the FULL scope section hard-asserts one
   * shot per beat against this block, so a dropped call-site arg must be a
   * compile error, not an empty sheet. Pass "{}" explicitly to withhold it.
   */
  beatSheetJson: string
  constraints: GlobalConstraints
  currentShotsJson: string
  existingShots: Shot[]
  fixedSegmentsJson: string
  fullCoverage: boolean
  hasFixedSegments: boolean
  isStructureMode: boolean
  latestUserMessage: string
  musicContextJson?: string
  notes: string[]
  params: PlannerToolParams
  pinnedRawUserPrompt: string
  promptRoute: UipPromptRoute
  rawUserPromptContext: string
  script: string
  /**
   * Pinned `enable_story_mode_v3` evaluation (Story Mode 3.0). Swaps the shot
   * contract to one chronological core_description plus a transition_to_next
   * hand-off, in place of the peak-frame + entry/exit triple. Gate-off sessions
   * render the V2 text byte-identically.
   *
   * Required for the same reason as `beatSheetJson` above: a prompt
   * input that silently defaults leaves a dropped call-site arg invisible --
   * here a gate-on session would quietly render the V2 contract. Pass `false`
   * explicitly to withhold it.
   */
  storyModeV3Enabled: boolean
  structureEdit: null | PlannerStructureEdit
  targetShotIds: string[]
  totalShots: number
  /**
   * Accepted for call-site stability but intentionally unused: planning is
   * model-agnostic -- every model gets the same visual-script
   * prompt.
   */
  transitionVideoModel?: string
  worldBibleJson: string
}

export function buildUipVisualScriptPromptForScope(
  params: BuildUipVisualScriptPromptForScopeParams,
): string {
  if (params.isStructureMode && params.structureEdit) {
    return buildStructureVisualPrompt({
      anchorAssetsJson: params.anchorAssetsJson,
      assetDescriptionsJson: params.assetDescriptionsJson,
      constraints: params.constraints,
      currentShotsJson: params.currentShotsJson,
      latestUserMessage: params.latestUserMessage,
      musicContextJson: params.musicContextJson,
      storyModeV3Enabled: params.storyModeV3Enabled,
      params: params.params,
      pinnedRawUserPrompt: params.pinnedRawUserPrompt,
      promptRoute: params.promptRoute,
      rawUserPromptContext: params.rawUserPromptContext,
      script: params.script,
      structureEdit: params.structureEdit,
      worldBibleJson: params.worldBibleJson,
    })
  }

  if (params.fullCoverage) {
    return buildFullVisualPrompt({
      anchorAssetsJson: params.anchorAssetsJson,
      assetDescriptionsJson: params.assetDescriptionsJson,
      beatSheetJson: params.beatSheetJson,
      constraints: params.constraints,
      fixedSegmentsJson: params.fixedSegmentsJson,
      hasFixedSegments: params.hasFixedSegments,
      latestUserMessage: params.latestUserMessage,
      musicContextJson: params.musicContextJson,
      storyModeV3Enabled: params.storyModeV3Enabled,
      notes: params.notes,
      params: params.params,
      pinnedRawUserPrompt: params.pinnedRawUserPrompt,
      promptRoute: params.promptRoute,
      rawUserPromptContext: params.rawUserPromptContext,
      script: params.script,
      worldBibleJson: params.worldBibleJson,
    })
  }

  return buildPartialVisualPrompt({
    anchorAssetsJson: params.anchorAssetsJson,
    assetDescriptionsJson: params.assetDescriptionsJson,
    constraints: params.constraints,
    currentShotsJson: params.currentShotsJson,
    latestUserMessage: params.latestUserMessage,
    musicContextJson: params.musicContextJson,
    storyModeV3Enabled: params.storyModeV3Enabled,
    params: params.params,
    pinnedRawUserPrompt: params.pinnedRawUserPrompt,
    promptRoute: params.promptRoute,
    rawUserPromptContext: params.rawUserPromptContext,
    script: params.script,
    targetShotIds: params.targetShotIds,
    targetShotsJson: JSON.stringify(
      params.existingShots.filter((shot) => params.targetShotIds.includes(shot.shot_id)),
      null,
      2,
    ),
    totalShots: params.totalShots,
    worldBibleJson: params.worldBibleJson,
  })
}

// =============================================================================
// Visual Script Prompt -- UIP scaffold + scope sections + thin wrappers
// =============================================================================
// FULL scope now uses the classic long-take visual-script builder for prompt
// parity. The scaffold below remains the UIP-native path for PARTIAL,
// STRUCTURE, and full-coverage non-FULL calls that need UIP editing semantics.

type VisualScriptScaffoldInput = {
  anchorAssetsJson: string
  assetDescriptionsJson: string
  constraints: GlobalConstraints
  enforceMandatoryUserUploads: boolean
  latestUserMessage: string
  musicContextJson?: string
  notes: string[]
  pinnedRawUserPrompt: string
  promptRoute: UipPromptRoute
  rawUserPromptContext: string
  scopeContextBlock: string
  scopeSection: string
  script: string
  storyModeV3Enabled: boolean
  worldBibleJson: string
}

/**
 * Music Context JSON (genre / bpm / section grid). The music route's rules name
 * it directly ("Honor the genre, tempo, and mood given in the Music Context
 * JSON"), so it has to travel with them; empty on every non-music session.
 */
function buildMandatoryAnchorBackedUploadSection(
  obligations: Array<{ consuming_anchor_ids: string[]; upload_asset_id: string }>,
): string {
  return obligations.length === 0
    ? ''
    : `
Mandatory anchor-backed upload bindings:
- Each selected upload below was canonicalized into one or more anchors.
- For EACH upload, at least one listed consuming_anchor_id MUST appear in pre_selected_assets of at least one shot with source="anchor_asset".
- Do not also bind the raw upload with source="user_upload".

${JSON.stringify(obligations, null, 2)}`
}

function buildMandatoryUserUploadSection(mandatoryIds: string[]): string {
  return `
Mandatory user-uploaded bindings:
- The user explicitly chose the following asset_ids in the brand-review card; each represents an intentional creative signal.
- EACH id below MUST appear in pre_selected_assets of at least one shot with source="user_upload".
- Pick the shot whose subject/topic is the closest plausible match. A weak match is acceptable; OMITTING a mandatory id is not.
- If you have more mandatory ids than shots, double up on the most relevant shots.

${JSON.stringify(mandatoryIds, null, 2)}`
}

function renderMusicContextSection(musicContextJson: string | undefined): string {
  const trimmed = musicContextJson?.trim()
  if (!trimmed) {
    return ''
  }
  return `\n\nMusic Context JSON:\n${trimmed}`
}

// Model-agnostic shot-duration guidance: every model plans against
// the same ~2-10s shot envelope. Model-specific generation behavior lives in
// the transition-generation stage, not planning.
const UIP_VISUAL_SCRIPT_SHOT_DURATION_GUIDANCE = {
  complexityRules: [
    'Short shots (2–3s): Simple, bold imagery with immediate impact. Single focal point.',
    'Medium shots (3–6s): Balance clarity and detail; can show progression.',
    'Long shots (6–10s): Richer visual narrative; consider evolving focus or scene development.',
  ].join('\n'),
  continuityProtocol: [
    'Universal Constraints (The Anti-Edit Protocol) — apply to every returned shot:',
    'You must describe a Single Atomic Moment per shot. Do not describe editing techniques or temporal shifts.',
    '- No Temporal Flow: Forbidden terms: "Time-lapse," "Rack focus," "Transitioning," "Morphing," "Fading." Choose ONE specific focal plane or moment in time.',
    '- No Spatial Splitting: Forbidden terms: "Split screen," "Diptych," "Collage," "Montage." Render one cohesive reality per shot.',
    '- No Relative References: Forbidden phrases: "From the previous shot," "Continuing the action," "Similar to before." Each shot description must be fully self-contained.',
    '- No Editing Tricks: Forbidden terms: "Match-cut," "Jump-cut," "Flashback."',
    "- Avoid Incidental Text: Do not describe small annotations, map labels, corner date stamps, or stray entity captions. Typography is only appropriate when it occupies dominant visual area as the composition's primary anchor (a single bold headline or large identifier).",
    '- On-Screen Text Language (CRITICAL): Visual prose (description / actions / atmosphere) MUST be written in English for downstream model compatibility. HOWEVER, any text that will visibly appear on the frame — signage, headlines, captions, disclaimers, brand names, UI strings, posters, quoted words, large typographic anchors — MUST be written in the SAME language as the input Voice-Over script and wrapped in single quotes inside the description. Examples (script in Spanish): "...a hospital sign reading \'Urgencias\' above the doors..."; "...the disclaimer \'Este contenido es solo informativo\' fades in..."; "...large bold word \'GASLIGHTING MÉDICO\' shatters in a dark void...". Never silently translate on-screen text to English.',
    '- No Inline Stage Directions: Do not embed parenthetical state markers like "(DIMMED)" or "(LOCKED)" inside descriptions. Describe the visual state directly.',
    '- Style Agnosticism: NEVER describe the rendering style (e.g., "stylized," "photorealistic," "cartoon," "vector"). Describe only geometry, motion, and layout.',
  ].join('\n'),
  coreDescriptionRule:
    '- core_description (required): The peak visual state — the most representative moment of this shot. This drives keyframe image generation. Be detailed and vivid: include subject, action, environment, lighting, texture, and atmosphere.',
  intro: 'Each shot is ~2–10s long. The visual description is split into three phases:',
  phaseRules: [
    '- entry_action (recommended): How the shot BEGINS — motion/camera/visual evolution during the first half (~1-3s). Not a brief hint; describe the full visual progression leading into the core state.',
    '- exit_action (recommended): How the shot ENDS — motion/camera/visual evolution during the second half (~1-3s). Describe how the scene evolves away from the core state toward the next shot.',
  ].join('\n'),
}

/**
 * Story Mode 3.0 shot contract, selected by the pinned
 * `enable_story_mode_v3` gate.
 *
 * `core_description` keeps its name but changes meaning: it is the whole clip
 * written in time order, not a peak still. The keyframe becomes the shot's
 * opening instant instead of its midpoint, and `transition_to_next` replaces
 * entry/exit as the way a shot reaches the next one -- so a generated clip
 * finally contains one complete shot rather than the tail of one and the head
 * of the next.
 *
 * The motion craft here (four-layer formula, frame-zero rule, camera-vs-subject
 * separation, the verb list) is lifted from the downstream transition rewrite
 * prompt in seedance2-montage-prompt.ts. That is where this design work already
 * existed; it is moved to where the story context actually lives, rather than
 * being reinvented.
 */
const UIP_VISUAL_SCRIPT_V3_SHOT_GUIDANCE = {
  continuityProtocol: [
    'Universal Constraints (The Anti-Edit Protocol) — apply to every returned shot:',
    'A shot is a Single Continuous Take. The camera and the action may move throughout it; what may not happen is a cut, a jump in time, or a transition effect inside the shot.',
    '- No Cuts Inside a Shot: Forbidden terms: "Match-cut," "Jump-cut," "cut to." If the idea needs a cut, it is a new shot.',
    '- No Time Jumps: Forbidden terms: "Time-lapse," "Flashback," "Later," "Meanwhile." The shot covers one unbroken span of time.',
    '- No Transition Effects Inside a Shot: Forbidden terms: "Morphing," "Dissolving," "Fading in/out," "Transitioning." Handing off to the next shot is decided by transition_to_next, never described here.',
    '- Continuous camera and optical change ARE allowed and encouraged: push in, pull out, pan, tilt, track, orbit, reframe, rack focus, and evolving light within the single take.',
    '- No Spatial Splitting: Forbidden terms: "Split screen," "Diptych," "Collage," "Montage." Render one cohesive reality per shot.',
    '- No Relative References: Forbidden phrases: "From the previous shot," "Continuing the action," "Similar to before." Each shot description must be fully self-contained.',
    "- Avoid Incidental Text: Do not describe small annotations, map labels, corner date stamps, or stray entity captions. Typography is only appropriate when it occupies dominant visual area as the composition's primary anchor (a single bold headline or large identifier).",
    '- On-Screen Text Language (CRITICAL): Visual prose (description / actions / atmosphere) MUST be written in English for downstream model compatibility. HOWEVER, any text that will visibly appear on the frame — signage, headlines, captions, disclaimers, brand names, UI strings, posters, quoted words, large typographic anchors — MUST be written in the SAME language as the input Voice-Over script and wrapped in single quotes inside the description. Examples (script in Spanish): "...a hospital sign reading \'Urgencias\' above the doors..."; "...the disclaimer \'Este contenido es solo informativo\' holds across the lower third..."; "...large bold word \'GASLIGHTING MÉDICO\' shatters in a dark void...". Never silently translate on-screen text to English.',
    '- No Inline Stage Directions: Do not embed parenthetical state markers like "(DIMMED)" or "(LOCKED)" inside descriptions. Describe the visual state directly.',
    '- Style Agnosticism: NEVER describe the rendering style (e.g., "stylized," "photorealistic," "cartoon," "vector"). Describe only geometry, motion, and layout.',
  ].join('\n'),
  handOffSection: `Step 5: Hand-off to the Next Shot (transition_to_next)

How this shot hands off to the next one. This decides how the clip is generated, so it
is a production decision, not a stylistic note.

- "cut"        The two shots are separate moments. The clip is generated from this
               shot's opening frame alone, and the cut is made in post. Always clean.
- "continuous" The camera physically carries from this shot into the next shot's
               opening composition, with no cut. The clip is generated to land on it.

Choose "continuous" only when a real camera could plausibly travel between the two
compositions within this shot's remaining time. Otherwise choose "cut".

Aesthetic mode is the strongest signal:
- Live Action -> Live Action, different place / time / subject: choose "cut". A morph
  between two photographed realities reads as an artifact, not as an edit.
- Live Action -> Live Action, same space with a reachable camera path: "continuous" is allowed.
- Either side is Composited Graphic or UI-Infographic: "continuous" is safer -- shape and
  layout change is native visual language there, so a flowing hand-off reads as design.

When in doubt choose "cut": it is always clean, while a failed "continuous" is a visible
defect. The last shot has no next shot -- set transition_to_next to null.`,
  shotSection: `Step 4: Shot Description (one continuous take, written in time order)

Each shot is ~2-10s and becomes ONE generated clip. core_description is the design for
that whole clip: what the viewer sees from its first instant to its last.

- Write it in chronological order, starting from the opening instant. That opening
  instant is also this shot's keyframe, so lead with a composition that can be drawn
  as a still, then let it evolve.
- Carry four layers as the shot progresses:
    [Subject] + [Action, present tense, already in motion] + [Environment / lighting] + [Camera]
- Design the motion, do not name it. "She reacts" is empty. "She snaps her head toward
  the door, shoulders dropping as the light behind her cuts out" is a design.
- Use concrete, active motion verbs: reaches, snaps, turns, tracks, whip-pans, reveals,
  reacts, lands, launches, passes, opens, closes, collides, transforms through action.
- The action is already underway at the first instant. Do not spend the opening
  re-describing a static tableau.
- Separate camera movement from subject movement: if the subject moves strongly, hold
  the camera; if the camera moves, keep the subject's own motion simple.
- Size the motion to this beat's duration (Beat Sheet JSON below; in PARTIAL scope
  derive it from the target shot's time range in Current Full Shots). A 2s shot carries
  one clear move; an 8s shot earns a developing progression.
- This is a design brief, not the final render prompt. Be specific about what happens
  and in what order; a later step expands it into the model-ready prompt. Typically
  2-4 sentences.

Position Requirements:
- Last shot of the full sequence: transition_to_next MUST be null.
- Every other shot: transition_to_next MUST be "cut" or "continuous".
- Every shot needs a description, including a held or static one -- describe what
  sustains it (drifting light, settling dust, a slow push) rather than omitting motion.`,
}

function buildVisualScriptScaffold(input: VisualScriptScaffoldInput): string {
  const brandBank = input.constraints.brand_bank ?? null
  const filteredAssetDescriptionsJson = filterAssetDescriptionsByBrandBank(
    input.assetDescriptionsJson,
    brandBank,
  )
  const describedAssetIds = extractKnownAssetIds(filteredAssetDescriptionsJson)
  const userUploadIds = extractUserUploadBrandAssetIds(brandBank)
  // Uploads absorbed into an anchor are represented by that anchor; the raw
  // upload must not ALSO be force-bound (it would contradict the "user_upload
  // only for residual, non-absorbed uploads" default below and, for a
  // multi-subject upload, inject an off-subject reference).
  const anchorConsumedIds = new Set(extractAnchorConsumedSourceAssetIds(input.anchorAssetsJson))
  const anchorSources = extractAnchorSourceAssetIdsByAnchorId(input.anchorAssetsJson)
  const mandatoryIds = input.enforceMandatoryUserUploads
    ? userUploadIds.filter((id) => !anchorConsumedIds.has(id))
    : []
  const anchorBackedObligations = input.enforceMandatoryUserUploads
    ? userUploadIds
        .filter((id) => anchorConsumedIds.has(id))
        .map((upload_asset_id) => ({
          upload_asset_id,
          consuming_anchor_ids: [...anchorSources]
            .filter(([, sourceIds]) => sourceIds.has(upload_asset_id))
            .map(([anchorId]) => anchorId),
        }))
    : []
  const allowedDirectUploadedAssetIds = JSON.stringify(
    [...new Set([...describedAssetIds, ...userUploadIds])],
    null,
    2,
  )
  const allowedAnchorAssetIds = JSON.stringify(
    extractKnownAnchorIds(input.anchorAssetsJson),
    null,
    2,
  )
  const globalConstraintsJson = JSON.stringify(input.constraints, null, 2)
  const notesJson =
    input.notes.length > 0 ? JSON.stringify(input.notes, null, 2) : JSON.stringify([], null, 2)
  const v3 = input.storyModeV3Enabled
  const routeGuidance = renderVisualScriptRouteGuidance(input.promptRoute, v3)
  // Brand sessions only: a brand logo/wordmark is a real asset, never something
  // to invent from the brand name. Without this the LLM writes "the <Brand>
  // logo" into a shot's visual with no asset bound, and the keyframe model
  // hallucinates a fake brand mark.
  // Empty string on non-brand sessions keeps their prompt byte-identical.
  // When an anchor is sourced from the user's real logo, name it so the LLM
  // binds it to brand-identity shots instead of a product or invented mark
  // (observed: a correct logo anchor, but the shot bound a product).
  const brandLogoRule = buildBrandLogoGuidance(brandBank, input.anchorAssetsJson)
  const mandatoryBindingsSection =
    mandatoryIds.length > 0 ? buildMandatoryUserUploadSection(mandatoryIds) : ''
  const mandatoryAnchorBindingsSection =
    buildMandatoryAnchorBackedUploadSection(anchorBackedObligations)
  const shotDurationGuidance = UIP_VISUAL_SCRIPT_SHOT_DURATION_GUIDANCE
  const continuityProtocol = v3
    ? UIP_VISUAL_SCRIPT_V3_SHOT_GUIDANCE.continuityProtocol
    : shotDurationGuidance.continuityProtocol
  const shotSection = v3
    ? UIP_VISUAL_SCRIPT_V3_SHOT_GUIDANCE.shotSection
    : `Step 4: Shot Description Structure (three temporal phases)
${shotDurationGuidance.intro}
${shotDurationGuidance.coreDescriptionRule}
${shotDurationGuidance.phaseRules}

Position Requirements (non-loop):
- First shot of the full sequence: entry_action MUST be null or omitted.
- Middle shots: provide entry_action and exit_action when meaningful motion exists.
- Last shot of the full sequence: exit_action MUST be null or omitted.
Omit entry/exit only for truly static shots (e.g., a logo frame or a single data point). For most shots, provide rich entry and exit sized to the available screen time.`
  const visualDescriptionFields = v3
    ? 'core_description'
    : 'core_description / entry_action / exit_action'
  const visualPrimarySchemaLines = v3
    ? `    "core_description": "string",
    "transition_to_next": "cut|continuous|null",
    "notes": ["optional note"]`
    : `    "core_description": "string",
    "entry_action": "string|null",
    "exit_action": "string|null",
    "availability": "HIGH|MED|LOW",
    "notes": ["optional note"]`
  const stepFiveSection = v3
    ? UIP_VISUAL_SCRIPT_V3_SHOT_GUIDANCE.handOffSection
    : `Step 5: Availability Assessment
Assess likelihood of finding a pre-existing Real World Asset (RWA) for each shot:
- HIGH: common imagery, everyday objects, famous public events, generic UI/chart.
- MED: niche imagery, specific combinations, uncommon professional settings.
- LOW: rare/surreal/hyper-specific imagery, anachronisms, bespoke motion graphics, proprietary UI, or GenAI-dependent visuals.`

  return `Role:
You are a careful, observant visual storyteller who specializes in the "Show, Don't Tell" principle, drawing on shared human experience and cultural reference to translate complex ideas into concrete, watchable visuals.

Input:
A finalized Voice-Over Script (VO).
A World Bible JSON (cinematic world-building context, thematic core, and evolution arc).
Asset Descriptions JSON (user-uploaded asset metadata).
Anchor Assets JSON (canonicalized recurring characters/objects with stable anchor IDs).
Global Constraints JSON.
User Intent Notes (additional constraints extracted from the user's request).
Plus scope-specific inputs (beat sheet for FULL; current shots + target_shot_ids for PARTIAL; current shots + structure_edit for STRUCTURE — see SCOPE section below).

Objective:
Preserve the Voice-Over text verbatim where applicable. Do not paraphrase, rewrite, or reorder.
For each shot in the defined scope, generate a visual plan that describes concrete, visible elements that can be filmed or generated.
Each visual description must be grounded in observable reality and serve the narrative intent.
You MUST honor the User Intent Notes as high-priority constraints for what the visuals should include or avoid.
Prompt Route: ${input.promptRoute}

Route-Specific Visual Planning Guidance:
${routeGuidance}
${brandLogoRule}
${continuityProtocol}

Step 1: The World Model (Visual Translation)
Translate the provided Global Rule JSON and World Bible into specific visual directives.
Context: Adapt tone, setting, and era into specific lighting, texture, and environment rules.
Consistency: Use world_bible.visual_strategy.resource_scope to enforce continuity (Object Permanence). Recurring characters/props should use the same canonical representation across shots.
Requirements: Honor every item in global_constraints.directives -- these are the user's required positive elements (specific moments, openings, characters, transitions); each must be realized somewhere in the shots.
Constraints: Adhere strictly to global_constraints.must_not_violate and world_bible.global_context.creative_guardrails.

Story Arc Alignment:
The world_bible defines an evolution_arc (3-act escalation). Map each shot to a phase of this arc. Ensure visual variety escalates accordingly:
- Opening shots (Act 1): Establish the world. Clean, focused imagery. Build recognition.
- Middle shots (Act 2): Develop complexity. Introduce variety in expression types and aesthetic modes.
- Climax shots (Act 3): Peak visual density and engagement. The hero moment — maximum impact.
Do NOT repeat the same expression_type OR the same aesthetic_mode for more than 3 consecutive shots across the full sequence.

Step 2: Three Visual Expression Types (Meaning Layer)
A single shot represents one Expression Type. Decide how the meaning becomes visible:
- Literal / Direct: Show the person or thing mentioned in the VO itself. Lowest ambiguity. Use when VO names concrete people, objects, or places. Identity Priority: if a specific person is named (e.g., "Elon Musk"), the visual MUST feature their face/likeness to establish identity. Do not obscure them with hands-only or over-the-shoulder shots unless identity is already established. Editorial Principle — Chronology: if the line involves history, the visual must match the Era.
- Cultural Context / Worldview: Show the human reality or societal value implied by the idea. Do not show the subject itself; show the world around it (e.g., freedom, chaos, progress, intimacy). Use Implication rather than Illustration.
- Symbolic / Abstract: Show meaning through formal sign systems — data, diagrams, UI. The image must be "read."

Expression Type Distribution (strong preference):
- Literal ~45%, Symbolic ~45%, Cultural Context ~10% (±10% per type based on content).
- DIVERSITY REQUIREMENT: Never use only one expression type for the entire video.

Step 3: Aesthetic Mode — Visual Tools & Syntax (Execution Layer)
Choose a visual presentation form to realize the selected Expression Type. Produce a freeform description of strictly diegetic elements. Center your description around the Modal Syntax:

A) Live Action / Observable Reality
Best for: Literal, Cultural Context.
Strength: Human presence, real-world scale, physical texture, lived-in environments.
Recommended Modal Syntax: [Framing] of [Subject] [Action/Performance] in [Setting] + [Lighting/Texture Detail].

B) Composited / Graphic Reality
Best for: Literal, Symbolic.
Strength: Clarity + rhythm + conceptual compression. Boundary: composition must serve the idea.
Recommended Modal Syntax: [Layout/Composition] of [Subject/Graphic Object] performing [Motion] on [Canvas] + [Geometric Details].

C) UI / Infographic Reality
Best for: Symbolic (claims, data, processes).
Strength: Trust, legibility, argumentation. Boundary: keep it generic or brand-consistent.
Recommended Modal Syntax: [Data Visualization] demonstrating [Relationship/Progression] within [Interface] + [Single Dominant Readable Element].

Aesthetic Mode Distribution (strong preference):
- Default preference order: Live Action > Composited Graphic >>> UI-Infographic.
- Strongly prefer Live Action when the script discusses concrete entities, people, or physical scenes. Live Action shots paired with an anchor asset produce the best visual consistency.
- Use Composited Graphic sparingly for genuinely abstract concepts that cannot be shown in observable reality.
- UI-Infographic HARD CAP: ≤10% of total shots (e.g., max 1–2 shots in a 16-shot video). It is OK to be 0%.
- Do NOT use UI-Infographic or abstract graphics as a shortcut to avoid depicting a concrete subject. If the script talks about a seal diving, show the seal diving — do not show an abstract depth gauge.
- Do NOT use UI-Infographic in two adjacent shots.
- DIVERSITY REQUIREMENT: Never use only one aesthetic_mode for the entire video.

Plausibility Gate (Live Action vs Composited Graphic):
If the visual requires anachronistic collision, overlay/collage language, or intentionally unreal physics, choose Composited Graphic even if subjects are real.

Universal Diegetic Constraints:
Define the visual as a single, unbroken span of physical reality.
- Temporal Linearity: Treat the visual as a continuous window into a timeline that moves strictly forward without interruption.
- Physical Stability: Maintain the structural integrity of objects. Elements evolve only through natural mechanics (movement, lighting, physics).
- Frame Unity: Compose the image within a single, unified environment. Resolve comparisons through compositional interaction (e.g., side-by-side) or juxtaposing contrasting elements within the same physical space.
- Optical Reality: Define perspective strictly by the Subject's scale and position. Prioritize Identity (faces) for people and Texture for objects.

${shotSection}

Scene Richness Rule:
Each shot description MUST go beyond character placement. Include at least one of:
- Lighting conditions (harsh spotlight, golden hour, dim fluorescent)
- Material textures (worn leather, wet pavement, frosted glass)
- Ambient elements (falling rain, moving smoke, scattered papers)
- Spatial context (crowded background figures, distant skyline, cluttered desk)
Do not write staging directions ("The character stands in the set"). Paint the scene: describe what the camera SEES, including the environment around characters.

Product Coverage Rule (promotional / commercial videos only):
If the video is primarily selling, demoing, or marketing a product, ensure ≥15% of shots are product-first visuals where the product is the clear primary subject.

Symbiosis Rule (Human-Object Interaction):
When a protagonist or narrator character exists and the script describes product usage, the character MUST be shown actively interacting with the product — not merely standing nearby.

Visual Complexity by Shot Length (Guidance):
${shotDurationGuidance.complexityRules}

${stepFiveSection}

=== COMMON HARD CONSTRAINTS (apply to every returned shot) ===

Asset binding rule (pre_selected_assets):
- Each shot MUST include pre_selected_assets: { asset_id, source, usage }[].
- source="user_upload": asset_id MUST appear verbatim in the Allowed Direct Uploaded Asset IDs list below.
- source="anchor_asset": asset_id MUST appear verbatim in the Allowed Anchor Asset IDs list below.
- DO NOT invent, paraphrase, or infer asset_ids from the script topic or brand name. If no listed id fits, emit pre_selected_assets: [].
- An id only appears in Asset Descriptions JSON or Anchor Assets JSON if it is bound to a real file; the two Allowed lists are the authoritative source.
${mandatoryBindingsSection}
${mandatoryAnchorBindingsSection}
- Use source="anchor_asset" by default for recurring continuity subjects (canonicalized characters or recurring props).
- Use source="user_upload" only for residual direct-use uploads not absorbed into anchor assets, or when the user explicitly wants the raw uploaded image itself to be the visual reference.
- Only attach an asset when it is the genuine visual subject or visual anchor of the shot. Do NOT default to attaching an asset to every shot.
- When a shot depicts a recognizable recurring entity present in the Anchor Assets list, you MUST bind that anchor_asset — this is how visual consistency is enforced.
- Named-group reference rule: When the shot collectively references members of a named group from key_entities - via group nouns ("the girls", "the trio", "the band", "the crew"), the group's name itself ("the Comets"), bare plural pronouns referring to known members ("they", "them"), or numeral + plural ("three girls") that quantitatively matches a named group's roster - you MUST bind EVERY member's asset ID through pre_selected_assets, not just the most-mentioned individual. Identify membership by cross-referencing key_entities (which may use the format "GroupName (Member1, Member2, Member3)") with each asset's proper_name field in the Anchor Assets JSON. Example: if key_entities contains "The Comets (Ava, Bea, Cleo)" and the manifest has assets with proper_name "Ava", "Bea", and "Cleo", any shot whose core_description says "the girls cheer" or "three girls strike a pose" must bind all three asset IDs. Do not omit a member just because the prose only spelled out one name.
- Prefer Live Action shots with anchor assets over abstract/graphic representations when the script discusses a concrete entity. Showing the actual character/object with its anchor reference produces better visual results than stylized abstractions.
- When you bind an anchor_asset, that entity's appearance in your visual description (${visualDescriptionFields}) MUST be consistent with that anchor's visual_reference in the Anchor Assets JSON. Follow the visual_reference for identity/physiology (who or what it is); do NOT invent conflicting identity traits (different age, build, species, color, or defining features). The visual_reference is the single source of truth for the anchor's identity — describe pose, action, framing, and setting freely, but keep the entity itself faithful to it.
- Avoid assigning multiple assets to one shot unless the shot genuinely requires them.
- Avoid repetitive assignment of the same asset across many shots unless the sequence is a continuous story line or the user explicitly wants that reuse.
- If no relevant asset is needed (pure landscape, abstract data viz with no recognizable entities), output [] explicitly. Never omit pre_selected_assets.

Visual rule:
- visual_primary must describe one coherent, continuous shot moment.
- Honor all Universal Diegetic Constraints above (no montage, no split screen, no transitions).
- Keep continuity aligned with world_bible and global_constraints.
- edit_mode EXACT: any text in exact_locks MUST appear verbatim in core_description for the matching shot.
- edit_mode CREATIVE: prioritize strategy-level changes (expression type, aesthetic mode, composition) over longer wording. CREATIVE does NOT mean longer by default.
- Forbidden: synonym-only expansion or verbose paraphrase of the same visual idea.

Output format:
- Return a JSON object with key "shots".
- No markdown fences. No extra commentary.
- time.start_s and time.end_s are placeholder fields for the UIP runtime; set both to 0 for every returned shot.

${input.scopeSection}

Output item schema:
{
  "shot_id": "shot_1",
  "order": 1,
  "time": { "start_s": 0, "end_s": 0 },
  "audio_vo": "string",
  "visual_primary": {
    "expression_type": "Literal|Symbolic|Cultural Context",
    "aesthetic_mode": "Live Action|Composited Graphic|UI-Infographic",
${visualPrimarySchemaLines}
  },
  "pre_selected_assets": [
    {
      "asset_id": "uploaded_asset_id_or_anchor_id",
      "source": "user_upload | anchor_asset",
      "usage": "primary anchor"
    }
  ]
}

Allowed Direct Uploaded Asset IDs:
${allowedDirectUploadedAssetIds}

Allowed Anchor Asset IDs:
${allowedAnchorAssetIds}

Anchor Assets JSON:
${input.anchorAssetsJson}

World Bible JSON:
${input.worldBibleJson}${renderMusicContextSection(input.musicContextJson)}

Asset Descriptions JSON:
${filteredAssetDescriptionsJson}

Global Constraints JSON:
${globalConstraintsJson}

Script:
${input.script}

User Intent Notes:
${notesJson}

Raw User Prompt Context:
${input.rawUserPromptContext}

Pinned Raw User Prompt:
${input.pinnedRawUserPrompt}

Latest User Message:
${input.latestUserMessage}

${input.scopeContextBlock}

Reference config:
${JSON.stringify(LONG_TAKE_VISUAL_SCRIPT_CONFIG, null, 2)}
`
}

// =============================================================================
// Scope sections -- each mode's unique "what to return / how to number" rules
// =============================================================================

function buildFullScopeSection(hasFixedSegments: boolean): string {
  const fixedSegmentContract = hasFixedSegments
    ? `4) Fixed Segments Contract (HARD, overrides rule 3 audio source):
   - fixed_segments_json below is NON-EMPTY — treat it as the mandatory segmentation.
   - Return exactly one shot per fixed segment, in the same order.
   - Do not add, remove, merge, split, or reorder segments.
   - Each returned shot's audio_vo must match its corresponding fixed segment's audio verbatim.`
    : `4) Fixed Segments Contract:
   - fixed_segments_json below is empty. Follow the beat_sheet segmentation as-is.`

  return `=== SCOPE — FULL (one-to-one beat alignment) ===
1) Beat lock: exactly one shot per beat.
   - Output shot count MUST equal beat_sheet length.
   - Shot order MUST match beat order.
2) Shot ID: shot_id MUST be exactly "shot_" + String(beat_id). Example: beat_id=1 → shot_id="shot_1".
3) Audio source: each shot's audio_vo copies the corresponding beat's segment_text verbatim. Do not reorder beats.
${fixedSegmentContract}
5) This is a FULL visual refresh: output the complete final pre_selected_assets plan for every shot. Empty [] is valid and still required (never omit the field).
6) Motion / pacing guidance:
   - Use beat_sheet duration and segmentation intent when available.
   - Apply "Visual Complexity by Shot Length" (above) to each beat's duration / word count.`
}

function buildPartialScopeSection(totalShots: number, storyModeV3Enabled: boolean): string {
  // Edge positions mean different things per contract: V2 nulls the entry/exit
  // action at the sequence ends, V3 nulls the hand-off on the last shot only --
  // a PARTIAL target in the middle still has a next shot to reach.
  const edgePositionRules = storyModeV3Enabled
    ? `   - If a target shot's order is ${totalShots} in the full sequence (last shot), transition_to_next MUST be null.
   - Otherwise transition_to_next MUST be "cut" or "continuous", chosen against the NEXT shot as shown in "Current Full Shots" -- including when that next shot is not itself a target.`
    : `   - If a target shot's order is 1 in the full sequence (first shot), entry_action MUST be null unless strongly justified.
   - If a target shot's order is ${totalShots} (last shot), exit_action MUST be null unless strongly justified.`
  return `=== SCOPE — PARTIAL (scoped rewrite) ===
1) Target selection: Return EXACTLY one shot object per target_shot_id, in the SAME order as target_shot_ids. Do NOT return shots outside target_shot_ids.
2) Shot ID: Preserve shot_id EXACTLY as provided in target_shot_ids. Do not renumber.
3) Audio source: Unless the user explicitly requests an audio change, preserve each target shot's existing audio_vo semantics; keep it aligned with the surrounding full script. audio_vo must stay non-empty.
4) Non-target preservation: Do NOT create, delete, or reorder non-target shots. They stay exactly as shown in "Current Full Shots".
5) PARTIAL does NOT re-segment. Do not change shot boundaries; only rewrite the visual content (and optionally visual_primary metadata) of the listed targets.
6) Surrounding coherence: Review the full shot table before rewriting each target. Keep target shots coherent with neighboring non-target shots in setting / scale / progression.
7) Global cross-scope rules still apply:
   - Expression/Aesthetic diversity: do NOT create runs of >3 consecutive same-type shots once the rewrite is inserted back.
   - UI-Infographic HARD CAP (≤10% of total shots, total_shots=${totalShots}) applies globally. If non-target shots already saturate UI near the cap, do not push targets into UI-Infographic.
8) Edge positions:
${edgePositionRules}
9) For every returned target shot, explicitly output the final pre_selected_assets (even if []).`
}

function buildStructureScopeSection(structureEdit: PlannerStructureEdit): string {
  return `=== SCOPE — STRUCTURE EDIT (op="${structureEdit.op}") ===
1) Shot count by op:
   - INSERT: return EXACTLY 1 new shot.
   - SPLIT: return EXACTLY one shot per split segment.
   - MERGE: return EXACTLY 1 merged shot.
   This call is for op="${structureEdit.op}".
2) Return ONLY the new or replacement shots. Do NOT return unaffected original shots.
3) Audio source by op:
   - INSERT: audio_vo comes from the planner-side structure_edit payload.
   - SPLIT: each returned shot's audio_vo is a verbatim contiguous slice of the source shot's audio_vo, in order. Concatenated slices must equal the source verbatim.
   - MERGE: the merged shot's audio_vo is the verbatim concatenation of the source shots' audio_vo, in order.
4) Shot ID: pick stable placeholder IDs of the form "shot_<N>" that do NOT collide with existing IDs in "Current Shots". The UIP runtime normalizes ordering and re-numbers after the tool returns.
5) Surrounding coherence: new/replacement shots must remain compatible with surrounding existing shots in setting / scale / narrative logic.
6) Global cross-scope rules still apply:
   - Expression/Aesthetic diversity: once inserted into the sequence, do NOT break the "no >3 consecutive same-type" rule.
   - UI-Infographic HARD CAP (≤10% of total shots) still applies globally.
7) For every returned shot, explicitly output the final pre_selected_assets (even if []).`
}

// =============================================================================
// Thin wrappers -- compose scaffold + mode-specific scope section + context
// =============================================================================

// Beat-locked (music) sheets carry time_range_audited without text_audited: their cut points sit
// on musical beats and instrumental beats have an empty segment_text. Tell the model how to fill
// those beats instead of letting it invent lyrics or skip them.
function buildBeatLockedGuidance(beatSheetJson: string): string {
  const meta = parseFullScopeBeatSheetMeta(beatSheetJson)
  if (!meta.timeRangeAudited || meta.textAudited) {
    return ''
  }
  return `
MUSIC BEAT SHEET RULES (this beat sheet was derived from the song's musical beat grid):
- Each beat is one shot and its time_range is LOCKED to a musical beat. Never merge, split, or retime beats.
- Beats with a non-empty segment_text carry sung lyrics: the visual should express or play against that lyric. Keep audio_vo equal to the segment_text.
- Beats with an EMPTY segment_text are instrumental (intro / interlude / outro): create a purely visual shot -- performance, dance, environment, or abstract energy that carries the song's momentum. Leave audio_vo as an empty string. Do NOT invent lyrics, dialogue, or on-screen text.
`
}

function buildFullVisualPrompt(params: {
  anchorAssetsJson: string
  assetDescriptionsJson: string
  beatSheetJson: string
  constraints: GlobalConstraints
  fixedSegmentsJson: string
  hasFixedSegments: boolean
  latestUserMessage: string
  musicContextJson?: string
  notes: string[]
  params: PlannerToolParams
  pinnedRawUserPrompt: string
  promptRoute: UipPromptRoute
  rawUserPromptContext: string
  script: string
  storyModeV3Enabled: boolean
  worldBibleJson: string
}): string {
  const scopeContextBlock = `Beat Sheet JSON:
${params.beatSheetJson}
${buildBeatLockedGuidance(params.beatSheetJson)}
Fixed Segments JSON:
${params.fixedSegmentsJson}

Runtime Parameters:
- scope / edit_mode params: ${JSON.stringify(params.params, null, 2)}`

  return buildVisualScriptScaffold({
    anchorAssetsJson: params.anchorAssetsJson,
    assetDescriptionsJson: params.assetDescriptionsJson,
    constraints: params.constraints,
    enforceMandatoryUserUploads: true,
    latestUserMessage: params.latestUserMessage,
    musicContextJson: params.musicContextJson,
    storyModeV3Enabled: params.storyModeV3Enabled,
    notes: params.notes,
    pinnedRawUserPrompt: params.pinnedRawUserPrompt,
    promptRoute: params.promptRoute,
    rawUserPromptContext: params.rawUserPromptContext,
    script: params.script,
    scopeContextBlock,
    scopeSection: buildFullScopeSection(params.hasFixedSegments),
    worldBibleJson: params.worldBibleJson,
  })
}

function buildPartialVisualPrompt(params: {
  anchorAssetsJson: string
  assetDescriptionsJson: string
  constraints: GlobalConstraints
  currentShotsJson: string
  latestUserMessage: string
  musicContextJson?: string
  params: PlannerToolParams
  pinnedRawUserPrompt: string
  promptRoute: UipPromptRoute
  rawUserPromptContext: string
  script: string
  storyModeV3Enabled: boolean
  targetShotIds: string[]
  targetShotsJson: string
  totalShots: number
  worldBibleJson: string
}): string {
  const scopeContextBlock = `Runtime Parameters:
- scope / edit_mode params: ${JSON.stringify(params.params, null, 2)}
- target_shot_ids: ${JSON.stringify(params.targetShotIds, null, 2)}
- total_shots: ${params.totalShots}

Current Full Shots (JSON):
${params.currentShotsJson}

Current Target Shots (JSON):
${params.targetShotsJson}`

  return buildVisualScriptScaffold({
    anchorAssetsJson: params.anchorAssetsJson,
    assetDescriptionsJson: params.assetDescriptionsJson,
    constraints: params.constraints,
    enforceMandatoryUserUploads: false,
    latestUserMessage: params.latestUserMessage,
    musicContextJson: params.musicContextJson,
    storyModeV3Enabled: params.storyModeV3Enabled,
    notes: [],
    pinnedRawUserPrompt: params.pinnedRawUserPrompt,
    promptRoute: params.promptRoute,
    rawUserPromptContext: params.rawUserPromptContext,
    script: params.script,
    scopeContextBlock,
    scopeSection: buildPartialScopeSection(params.totalShots, params.storyModeV3Enabled),
    worldBibleJson: params.worldBibleJson,
  })
}

function buildStructureVisualPrompt(params: {
  anchorAssetsJson: string
  assetDescriptionsJson: string
  constraints: GlobalConstraints
  currentShotsJson: string
  latestUserMessage: string
  musicContextJson?: string
  params: PlannerToolParams
  pinnedRawUserPrompt: string
  promptRoute: UipPromptRoute
  rawUserPromptContext: string
  script: string
  storyModeV3Enabled: boolean
  structureEdit: PlannerStructureEdit
  worldBibleJson: string
}): string {
  const scopeContextBlock = `Runtime Parameters:
- scope / edit_mode params: ${JSON.stringify(params.params, null, 2)}
- structure_edit: ${JSON.stringify(params.structureEdit, null, 2)}

Current Shots (JSON):
${params.currentShotsJson}`

  return buildVisualScriptScaffold({
    anchorAssetsJson: params.anchorAssetsJson,
    assetDescriptionsJson: params.assetDescriptionsJson,
    constraints: params.constraints,
    enforceMandatoryUserUploads: false,
    latestUserMessage: params.latestUserMessage,
    musicContextJson: params.musicContextJson,
    storyModeV3Enabled: params.storyModeV3Enabled,
    notes: [],
    pinnedRawUserPrompt: params.pinnedRawUserPrompt,
    promptRoute: params.promptRoute,
    rawUserPromptContext: params.rawUserPromptContext,
    script: params.script,
    scopeContextBlock,
    scopeSection: buildStructureScopeSection(params.structureEdit),
    worldBibleJson: params.worldBibleJson,
  })
}
