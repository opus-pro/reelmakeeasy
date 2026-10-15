import { buildLongTakeRoutedPromptTemplate, type LongTakePromptRoute } from '../prompt-router'

export type WorldBibleUserAssetContext = {
  characters: unknown[]
  file_understanding?: unknown[]
  files?: unknown[]
  objects: unknown[]
}

interface WorldBibleBaseParams {
  promptRoute?: LongTakePromptRoute
  script: string
  /**
   * When true, scopes THE ID LOCK away from a subject-supplying
   * asset's photographic backdrop -- see the constants below. Only consumed
   * by `buildLongTakeWorldBibleExpertPrompt` (the UIP path); the Enriched
   * builder accepts the field for call-site stability but leaves its clauses
   * on the legacy wording, since the classic path has no orgId to gate on.
   */
  settingIntentEnabled?: boolean
  /**
   * Accepted for call-site stability but intentionally unused: planning is
   * model-agnostic -- every model gets the same world-bible prompt.
   */
  transitionVideoModel?: string
  userAssetContext: WorldBibleUserAssetContext
}

type WorldBibleEnrichedParams = WorldBibleBaseParams

interface WorldBibleLegacyParams extends WorldBibleBaseParams {
  userSimulationParameters?: string
}

// Gate-on replacements for the two ID LOCK clauses. Spec 1.3: masking
// the asset context does not starve this rule on its own, because
// buildPredeterminedGlobalContextDirective hands the model an authoritative
// topic/key_entities block and tells it to keep visual_strategy consistent with
// it -- and visual_strategy is where primary_stages lives.
const ENVIRONMENT_ID_LOCK_LEGACY =
  '  - THE ID LOCK: Allocate any environments provided in the user assets, tagging them strictly as [USER_ASSET: <id>].'

const ENVIRONMENT_ID_LOCK_SCOPED =
  '  - THE ID LOCK: Allocate an environment as a Stage only when a user asset actually SUPPLIES that environment (an empty room, a storefront, a venue, a landscape, a set). An asset that supplies a SUBJECT -- a person, a product, a logo -- does NOT license its photographic backdrop as a Stage: do not infer a location from wherever a subject happened to be photographed. Tag a genuine environment asset strictly as [USER_ASSET: <id>].'

const DETAIL_ID_LOCK_LEGACY =
  '  - THE ID LOCK: If a requested detail belongs to an item already in the user assets, map it to its parent object and tag as [USER_ASSET: <id>].'

const DETAIL_ID_LOCK_SCOPED =
  "  - THE ID LOCK: If a requested detail belongs to an item already in the user assets, map it to its parent object and tag as [USER_ASSET: <id>]. A subject's pose, framing, or interaction with its surroundings is NOT such a detail -- do not carry a composition over from a subject-supplying asset."

export function buildLongTakeWorldBibleEnrichedExpertPrompt(
  params: WorldBibleEnrichedParams,
): string {
  const { script, userAssetContext } = formatWorldBibleInputs(params)
  const promptRoute = resolveWorldBiblePromptRoute(params)

  if (promptRoute === 'abstract') {
    return buildAbstractLongTakeWorldBibleExpertPrompt({
      script,
      userAssetContext,
    })
  }
  if (promptRoute === 'ads-tangible') {
    return buildAdsTangibleLongTakeWorldBibleExpertPrompt({
      script,
      userAssetContext,
    })
  }
  if (promptRoute === 'ads-intangible') {
    return buildAdsIntangibleLongTakeWorldBibleExpertPrompt({
      script,
      userAssetContext,
    })
  }
  if (promptRoute === 'music') {
    return buildMusicLongTakeWorldBibleExpertPrompt({
      script,
      userAssetContext,
    })
  }

  const generalPrompt = `Role: Visionary Showrunner & World Builder.

Context: You are the creative visionary setting the stage for a cohesive visual narrative. You do not just organize pixels; you architect the physical reality that justifies the requested aesthetic. Your job is to build a "Cinematic Sandbox" where the story can unfold naturally — providing exactly enough structure to guide the creative execution without suffocating it.

Input: Script, available user/context notes, inferred genre/style signals, User-provided assets.

Objective: Establish a cohesive "World Bible." Translate the user's prompt and aesthetic requests into a tangible, atmospheric world.

The World-Building Protocol

Step 1: The Core Vision & Thematic Heart
Analyze the script and available context. Infer user intent, genre, and style signals from the script/context when they are not explicitly provided. What is the emotional or philosophical truth of this video? Every great video makes the viewer feel something. Define this Thematic Core — the single sentence truth that guides all production decisions.

Step 2: The Cinematic Sandbox

The inferred genre/style signals route how style and content interact:

If genre is character-driven, brand/promotional, persuasive, or fictional/narrative:
  Style is the lead. Architect the physical reality that justifies this requested style.
  - Example: "2D doodle style" → sandbox is a tactile drafting table covered in paper, crayons, and a wastebasket.
  - Example: "Moody Cinematic neon" → sandbox is a rich, humid night scene with practical light sources.

If genre is educational, documentary, news, explainer, tutorial, or factual:
  Content is the lead. Style is decorative rendering only — it dictates HOW the sandbox is rendered (materials, colors, line quality, lighting), not WHAT the sandbox contains.
  Build the sandbox around the SCRIPT's literal subject matter. If the script names real people, places, events, or concepts, those must appear literally in the sandbox.
  - Example: A legal-case explainer in "synthwave" style is a synthwave-rendered courtroom with synthwave-rendered lawyers, NOT a synthwave-rendered abstract void with no literal representation.
  - Example: A history documentary in "claymation" style is a claymation-rendered historical scene with claymation-rendered figures, NOT a claymation metaphor.

In ALL genres:
  Never emit a creative_guardrail of the form "No literal representations of [the script's actual subjects]" or "all concepts must be abstract metaphors". Style cannot override script content. The user's script defines what the world contains; the style only defines how it looks.

Step 3: Framework & The Evolution Arc
Use the inferred genre/style signals to select the best narrative framework for this story and map its 3-Act escalation:
- Character-driven narrative: Maps [The Current Reality] → [The Action/Journey] → [The Resolution].
- Logic-driven explainer/process: Maps [The Problem/Stasis] → [The Hidden Mechanism] → [The Epiphany/Data Validation].
- Persuasive/brand story: Maps [The User's Lack] → [Sensory Interaction with Product] → [The Aspirational Lifestyle].
Choose the framework that best fits the script content and express it as a concrete 3-phase evolution arc.

Step 4: Sculpting the Scope (Designing for Coverage)
The narrative will require "Coverage" (multiple vantage points within the same room). You must provide the physical stages and props necessary to do so.

- Primary Stages (The Arenas): Define up to 3 overarching physical locations (Rooms/Environments) where the video will take place.
  - THE ID LOCK: Allocate any environments provided in the user assets, tagging them strictly as [USER_ASSET: <id>].
  - THE GAP FILL: Invent complementary Stages only if user files are insufficient to tell the story. Tag them as [GENERATED_ASSET: <description>].

- Essential B-Roll (The Deliverables): Catalog specific props, vignettes, and human interactions requested in the script so they are woven into the story.
  - THE SYMBIOSIS RULE (Human-Object Interaction): Products do not exist in a vacuum. You must elevate a product's value by pairing pristine beauty shots with moments of hands-on human connection. If the prompt centers on an object, ensure you catalog moments of human usage that demonstrate exactly how it feels and functions in the real world (e.g., instead of just "A water bottle," generate "A hand twisting the cap" or "An athlete drinking deeply").
  - THE ID LOCK: If a requested detail belongs to an item already in the user assets, map it to its parent object and tag as [USER_ASSET: <id>].
  - THE GAP FILL: Tag completely new subjects as [GENERATED_ASSET: <description>].

Step 5: The Sensemaker Protocol (Creative Harmonization)
Users will often upload disparate, low-context, or seemingly contradictory raw files. Your job is to creatively harmonize them. IF a user file feels contradictory to the aesthetic, do not reject it; creatively justify its existence within the sandbox. Bend the asset to fit the world (e.g., a crude user sketch becomes a glowing neon schematic on a high-tech datapad).

Step 6: The Rhythmic Pulse (Motion Guidelines)
Establish a "North Star" for how the perspective glides through this world. Keep it high-level and focus on spatial flow rather than mechanical camera equipment.
- Define a Dominant Movement Axis (e.g., Horizontal flowing, Vertical ascending, or Z-Axis pushing deep).
- Define a Base Momentum (e.g., Smooth floating, organic drift).

User Asset Context:
${userAssetContext}

Script:
${script}

${WORLD_BIBLE_OUTPUT_FORMAT}`

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt,
    promptRoute,
    templateName: 'world-bible',
  })
}

export function buildLongTakeWorldBibleExpertPrompt(params: WorldBibleLegacyParams): string {
  const { script, userAssetContext } = formatWorldBibleInputs(params)
  const promptRoute = resolveWorldBiblePromptRoute(params)
  const userSimulationParameters = params.userSimulationParameters?.trim() || 'None'

  if (promptRoute === 'abstract') {
    return buildAbstractLongTakeWorldBibleExpertPrompt({
      script,
      userAssetContext,
      userSimulationParameters,
    })
  }
  if (promptRoute === 'ads-tangible') {
    return buildAdsTangibleLongTakeWorldBibleExpertPrompt({
      script,
      userAssetContext,
      userSimulationParameters,
    })
  }
  if (promptRoute === 'ads-intangible') {
    return buildAdsIntangibleLongTakeWorldBibleExpertPrompt({
      script,
      userAssetContext,
      userSimulationParameters,
    })
  }
  if (promptRoute === 'music') {
    return buildMusicLongTakeWorldBibleExpertPrompt({
      script,
      userAssetContext,
      userSimulationParameters,
    })
  }

  const generalPrompt = `Role: Visionary Showrunner & World Builder.

Context: You are the creative visionary setting the stage for a cohesive visual narrative. You do not just organize pixels; you architect the physical reality that justifies the requested aesthetic. Your job is to build a "Cinematic Sandbox" where the story can unfold naturally — providing exactly enough structure to guide the creative execution without suffocating it.

Input: Script, User Simulation Parameters (e.g., "Cyberpunk," "Papercraft," "Corporate Memphis"), User-provided assets.

Objective: Establish a cohesive "World Bible." Translate the user's prompt and aesthetic requests into a tangible, atmospheric world.

The World-Building Protocol

Step 1: The Core Vision & Thematic Heart
Analyze the script and user intent. What is the emotional or philosophical truth of this video? Every great video makes the viewer feel something. Define this Thematic Core — the single sentence truth that guides all production decisions.

Step 2: The Cinematic Sandbox

The inferred genre/style signals route how style and content interact:

If genre is character-driven, brand/promotional, persuasive, or fictional/narrative:
  Style is the lead. Architect the physical reality that justifies this requested style.
  - Example: "2D doodle style" → sandbox is a tactile drafting table covered in paper, crayons, and a wastebasket.
  - Example: "Moody Cinematic neon" → sandbox is a rich, humid night scene with practical light sources.

If genre is educational, documentary, news, explainer, tutorial, or factual:
  Content is the lead. Style is decorative rendering only — it dictates HOW the sandbox is rendered (materials, colors, line quality, lighting), not WHAT the sandbox contains.
  Build the sandbox around the SCRIPT's literal subject matter. If the script names real people, places, events, or concepts, those must appear literally in the sandbox.
  - Example: A legal-case explainer in "synthwave" style is a synthwave-rendered courtroom with synthwave-rendered lawyers, NOT a synthwave-rendered abstract void with no literal representation.
  - Example: A history documentary in "claymation" style is a claymation-rendered historical scene with claymation-rendered figures, NOT a claymation metaphor.

In ALL genres:
  Never emit a creative_guardrail of the form "No literal representations of [the script's actual subjects]" or "all concepts must be abstract metaphors". Style cannot override script content. The user's script defines what the world contains; the style only defines how it looks.

Step 3: Framework & The Evolution Arc
Decide the best narrative framework for this story and map its 3-Act escalation:
- Character-driven narrative: Maps [The Current Reality] → [The Action/Journey] → [The Resolution].
- Logic-driven explainer/process: Maps [The Problem/Stasis] → [The Hidden Mechanism] → [The Epiphany/Data Validation].
- Persuasive/brand story: Maps [The User's Lack] → [Sensory Interaction with Product] → [The Aspirational Lifestyle].
Choose the framework that best fits the script content and express it as a concrete 3-phase evolution arc.

Step 4: Sculpting the Scope (Designing for Coverage)
The narrative will require "Coverage" (multiple vantage points within the same room). You must provide the physical stages and props necessary to do so.

- Primary Stages (The Arenas): Define up to 3 overarching physical locations (Rooms/Environments) where the video will take place.
${params.settingIntentEnabled ? ENVIRONMENT_ID_LOCK_SCOPED : ENVIRONMENT_ID_LOCK_LEGACY}
  - THE GAP FILL: Invent complementary Stages only if user files are insufficient to tell the story. Tag them as [GENERATED_ASSET: <description>].

- Essential B-Roll (The Deliverables): Catalog specific props, vignettes, and human interactions requested in the script so they are woven into the story.
  - THE SYMBIOSIS RULE (Human-Object Interaction): Products do not exist in a vacuum. You must elevate a product's value by pairing pristine beauty shots with moments of hands-on human connection. If the prompt centers on an object, ensure you catalog moments of human usage that demonstrate exactly how it feels and functions in the real world (e.g., instead of just "A water bottle," generate "A hand twisting the cap" or "An athlete drinking deeply").
${params.settingIntentEnabled ? DETAIL_ID_LOCK_SCOPED : DETAIL_ID_LOCK_LEGACY}
  - THE GAP FILL: Tag completely new subjects as [GENERATED_ASSET: <description>].

Step 5: The Sensemaker Protocol (Creative Harmonization)
Users will often upload disparate, low-context, or seemingly contradictory raw files. Your job is to creatively harmonize them. IF a user file feels contradictory to the aesthetic, do not reject it; creatively justify its existence within the sandbox. Bend the asset to fit the world (e.g., a crude user sketch becomes a glowing neon schematic on a high-tech datapad).

Step 6: The Rhythmic Pulse (Motion Guidelines)
Establish a "North Star" for how the perspective glides through this world. Keep it high-level and focus on spatial flow rather than mechanical camera equipment.
- Define a Dominant Movement Axis (e.g., Horizontal flowing, Vertical ascending, or Z-Axis pushing deep).
- Define a Base Momentum (e.g., Smooth floating, organic drift).

User Simulation Parameters:
${userSimulationParameters}

User Asset Context:
${userAssetContext}

Script:
${script}

${WORLD_BIBLE_OUTPUT_FORMAT}`

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt,
    promptRoute,
    templateName: 'world-bible',
  })
}

function buildAbstractLongTakeWorldBibleExpertPrompt(params: {
  script: string
  userAssetContext: string
  userSimulationParameters?: string
}): string {
  const userSimulationParameters = params.userSimulationParameters?.trim()
  const styleSection = userSimulationParameters
    ? `User Simulation Parameters:
${userSimulationParameters}

`
    : ''

  return `Role: Editorial Visual Systems Director for abstract concept explainer videos.

Objective:
Create a simple visual system for an abstract explainer. Do not invent a cinematic world, emotional hero journey, or metaphor-heavy universe.

Core Principle:
The video should help viewers understand the idea quickly. Prefer clarity, labels, simple shapes, numbers, diagrams, screenshots, article panels, and light B-roll over symbolic cinematic scenes.

Visual System Rules:
- Minimalism over spectacle. Use simple graphic devices: paper, sticky notes, grids, cards, checkmarks, X marks, arrows, circles, labels, timelines, comparison columns, screenshots, simple charts.
- Keep abstraction level low. If the script names an idea directly, preserve that idea as readable text or a simple graphic. Do not replace clear claims with elaborate metaphors.
- Data and numbers are first-class visuals. Important quantities, rankings, dates, percentages, population counts, budgets, or named claims should appear as large readable numbers or simple charts.
- Preserve a creator-led explainer feel when the script sounds like a person teaching. Keep it clean, direct, and lightly designed.
- Motion should be editorial: reveal, highlight, circle, underline, cross out, slide cards, sort, stack, count up, and compare side by side.
- Avoid swirling particles, glowing brains, exploding plants, collapsing towers, magical transformations, mysterious objects, mazes, diamonds, or symbolic hero journeys unless the script explicitly asks for them.

Output Guidance:
- Use the existing World Bible JSON schema below.
- Set global_context.script_category to "concept_centric" unless the script is clearly object-centric.
- Set visual_strategy.cinematic_sandbox to a simple editorial explainer workspace or graphic system, not a literal cinematic world.
- Set visual_strategy.evolution_arc to the argument flow of the explainer, such as "Claim setup -> Explanation -> Implication/CTA".
- Use resource_scope.primary_stages for reusable editorial surfaces, such as paper desk, grid background, screenshot/article panel, simple chart canvas, or talking-head support space.
- Use resource_scope.essential_b_roll for direct evidence visuals, labels, numbers, simple diagrams, and screenshots needed by the script.
- Set world_physics.global_motion_paradigm to simple editorial motion, not camera choreography.

${styleSection}User Asset Context:
${params.userAssetContext}

Script:
${params.script}

${WORLD_BIBLE_OUTPUT_FORMAT}`
}

function buildAdsIntangibleLongTakeWorldBibleExpertPrompt(params: {
  script: string
  userAssetContext: string
  userSimulationParameters?: string
}): string {
  const userSimulationParameters = params.userSimulationParameters?.trim()
  const styleSection = userSimulationParameters
    ? `User Simulation Parameters:
${userSimulationParameters}

`
    : ''

  return `Role: Intangible Product Ad Visual Director.

Objective:
Create a simple visual system for a short-form ad selling a service, software product, platform, marketplace, app, agency, or brand offer.

Core Rule:
The brand and the product experience are the main visual anchors. Preserve the logo/wordmark, website/app UI, workflow, real examples, and any named creator/influencer.

Rules:
- Do not turn the ad into a generic explainer or unrelated metaphor sequence.
- Use recognizable brand moments: logo/wordmark, website/app screens, dashboards, listings, forms, messages, integrations, customer examples, proof moments, and CTA/end card visuals.
- If product UI, website, listing, or logo assets are uploaded, treat them as ground truth and reuse them consistently.
- If no UI/logo asset is uploaded, create a clean brand-labeled UI mockup or website/app screen based on the script.
- Use workflow lines, arrows, labels, callouts, before/after panels, and simple diagrams to connect abstract claims to the product experience.
- Do not invent unsupported prices, discounts, claims, certifications, phone numbers, guarantees, or exact UI details not implied by the script/assets.

Output Guidance:
- Use the existing World Bible JSON schema below.
- Set global_context.video_type to "commercial".
- Set global_context.script_category to "concept_centric" unless the ad is mostly a concrete UI walkthrough.
- Put brand, service/platform, website/app, creator, influencer, and third-party tool names in global_context.key_entities.
- Put brand, logo, UI, workflow, and CTA preservation rules in global_context.creative_guardrails.
- Use resource_scope.primary_stages for recurring UI surfaces, website/app screens, dashboard/listing pages, workflow canvases, or brand end cards.
- Use resource_scope.essential_b_roll for demo steps, recognizable tool examples, proof panels, customer examples, and CTA visuals.

${styleSection}User Asset Context:
${params.userAssetContext}

Script:
${params.script}

${WORLD_BIBLE_OUTPUT_FORMAT}`
}

function buildAdsTangibleLongTakeWorldBibleExpertPrompt(params: {
  script: string
  userAssetContext: string
  userSimulationParameters?: string
}): string {
  const userSimulationParameters = params.userSimulationParameters?.trim()
  const styleSection = userSimulationParameters
    ? `User Simulation Parameters:
${userSimulationParameters}

`
    : ''

  return `Role: Tangible Product Ad Visual Director.

Objective:
Create a simple visual system for a short-form ad selling a physical product.

Core Rule:
The product is the main visual anchor. Preserve the product, brand, packaging/logo, and any named creator/influencer.

Rules:
- Do not replace the product with generic metaphors or unrelated lifestyle scenes.
- Use product close-ups, packaging shots, hands-on demos, feature callouts, proof moments, and CTA/end card visuals.
- If no product/logo asset is uploaded, create a clean generated product mockup or brand-like packaging from the script.
- Do not invent unsupported prices, discounts, claims, or guarantees.

Output Guidance:
- Use the existing World Bible JSON schema below.
- Set global_context.video_type to "commercial".
- Set global_context.script_category to "object_centric" unless the ad is mostly lifestyle positioning.
- Put brand, product, creator, and influencer names in global_context.key_entities.
- Put product and brand preservation rules in global_context.creative_guardrails.

${styleSection}User Asset Context:
${params.userAssetContext}

Script:
${params.script}

${WORLD_BIBLE_OUTPUT_FORMAT}`
}

function buildMusicLongTakeWorldBibleExpertPrompt(params: {
  script: string
  userAssetContext: string
  userSimulationParameters?: string
}): string {
  const userSimulationParameters = params.userSimulationParameters?.trim()
  const styleSection = userSimulationParameters
    ? `User Simulation Parameters:
${userSimulationParameters}

`
    : ''

  return `Role: Music Video World Builder.

Objective:
Create a cohesive music-video visual world for a song, lyrics, uploaded track, or music-video request. The world should support performance, rhythm, emotion, recurring motifs, and artist/character continuity.

Core Principle:
Treat lyrics as raw visual material for a music video. Build a sandbox where performance, place, styling, movement, lighting, relationships, and recurring motifs can carry the song. Literal imagery, symbolism, and abstraction are all allowed when they feel intentional and cohesive.

Visual System Rules:
- Anchor the world around performers, protagonists, relationships, choreography, fashion, lighting, locations, and recurring motifs.
- Preserve lyric-local intent and emotional stance: playful, confident, seductive, confrontational, devotional, hopeful, ironic, or celebratory.
- Do not build the world as a checklist of lyric nouns. Choose 2-4 reusable visual anchors or motifs that can evolve across verses, hooks, and choruses.
- Do not pluralize color words into physical-object motifs. Preserve color terms as lighting, wardrobe, environment, or style descriptors unless an explicit physical noun is present.
- Keep unity, family, belonging, connection, freedom, hope, and healing specific to the world of the video: performers, friends, dancers, street scenes, stage moments, rooms, clubs, rehearsals, block parties, kitchens, cars, night exteriors, or other concrete lived-in settings. Generic parks, public-square crowds, hand-holding circles, and glowing-community tableaux are fallback choices, not defaults.
- Avoid explanatory captions, concept labels, educational diagrams, or "this represents..." visual language unless the user explicitly asks for an explainer treatment.
- Do not frame the visual world as a literal explanation of each lyric, and do not require shot descriptions to say "embodying the message that..." or similar explanatory phrasing.
- For hooks and choruses, plan reusable motifs that can escalate through staging, camera distance, performer energy, color intensity, and environment.

Output Guidance:
- Use the existing World Bible JSON schema below.
- Set global_context.video_type to "music_video" unless a clearer commercial, educational, or devotional purpose dominates.
- Put artist/performer, protagonist, relationship, place, and central motif entities in global_context.key_entities.
- Put music-video visual language, no explanatory text, and motif-continuity rules in global_context.creative_guardrails.
- Set visual_strategy.cinematic_sandbox to a music-video world: performance space, intimate room, street/night exterior, stage, dance setting, symbolic motif environment, or another cohesive setting implied by the song/style/assets.
- Set visual_strategy.evolution_arc to the song's emotional/section arc, such as "intro/verse setup -> chorus motif escalation -> final chorus/outro payoff".
- Use resource_scope.primary_stages for reusable performance/relationship/motif locations.
- Use resource_scope.essential_b_roll for specific expressive actions, motifs, wardrobe/fashion beats, and human interactions rather than a one-to-one prop list for lyric words.
- Set world_physics.global_motion_paradigm to rhythm-aware music-video motion.

${styleSection}User Asset Context:
${params.userAssetContext}

Script:
${params.script}

${WORLD_BIBLE_OUTPUT_FORMAT}`
}

function formatWorldBibleInputs(params: WorldBibleBaseParams): {
  script: string
  userAssetContext: string
} {
  return {
    script: params.script?.trim() || 'No script provided.',
    userAssetContext: JSON.stringify(
      params.userAssetContext || { characters: [], objects: [] },
      null,
      2,
    ),
  }
}

function resolveWorldBiblePromptRoute(
  params: WorldBibleBaseParams,
): LongTakePromptRoute | undefined {
  // Planning is model-agnostic: the classified route applies to
  // every transition video model.
  return params.promptRoute
}

const WORLD_BIBLE_OUTPUT_FORMAT = `Output Format:
Output a single valid JSON object. Do not include markdown formatting.

{
  "global_context": {
    "video_type": "string (commercial / educational / narrative / news)",
    "script_category": "string (object_centric / concept_centric / brand_lifestyle)",
    "topic": "string (1 sentence describing subject + theme)",
    "key_entities": ["string (companies, people, institutions, industries)"],
    "geo_scope": "string (countries/cities relevant to the topic)",
    "time_scope": "string (past event / current news / future projection)",
    "tone": "string",
    "creative_guardrails": ["string (3-6 constraints that must not be violated)"]
  },
  "thematic_core": "string (the single sentence emotional/philosophical truth)",
  "visual_strategy": {
    "cinematic_sandbox": "string (the tangible physical reality of this world)",
    "evolution_arc": "string (3-act arc: Phase1 → Phase2 → Phase3)",
    "resource_scope": {
      "primary_stages": ["string (Stage N: description with [USER_ASSET] or [GENERATED_ASSET] tags)"],
      "essential_b_roll": ["string (specific props/vignettes/interactions with asset tags)"]
    },
    "asset_harmonization": "string (how disparate user files are creatively unified)"
  },
  "world_physics": {
    "global_motion_paradigm": {
      "dominant_movement_axis": "string",
      "base_momentum": "string"
    }
  }
}`
