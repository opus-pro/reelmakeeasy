import { type CameraStyle } from '../camera-craft'
import { buildLongTakeRoutedPromptTemplate, type LongTakePromptRoute } from '../prompt-router'

import {
  buildAbstractLongTakeVisualScriptPrompt,
  buildAdsIntangibleLongTakeVisualScriptPrompt,
  buildAdsTangibleLongTakeVisualScriptPrompt,
  buildLoopPositionRules,
  buildMusicLongTakeVisualScriptPrompt,
  buildNonLoopPositionRules,
} from './long-take-visual-script-route-prompts'

export type LongTakeAssetManifestOutput = {
  asset_manifest: Array<{
    asset_id: string
    is_multi_angle?: boolean
    keyword: string
    proper_name: null | string
    source: 'USER_FILE' | null
    source_file_id: null | string
    source_passthrough?: boolean
    type: 'Character' | 'Prop'
    visual_reference: string
    visual_tag: string
  }>
}

export type LongTakeBeatSheetOutput = {
  beat_sheet: Array<{
    beat_id: number
    duration?: number
    segment_text: string
    time_range?: { end: number; start: number }
  }>
  text_audited?: boolean
  time_range_audited?: boolean
}

export type LongTakeUserAssetsAnalysisOutput = {
  characters: unknown[]
  files: unknown[]
  mandatory_user_upload_bindings?: Array<{
    asset_id: string
    instruction: string
  }>
  objects: unknown[]
}

export type LongTakeWorldBibleOutput = {
  global_context?: {
    brand_scope?: string
    creative_guardrails?: string[]
    geo_scope?: string
    key_entities?: string[]
    script_category?: 'brand_lifestyle' | 'concept_centric' | 'object_centric'
    time_scope?: string
    tone?: string
    topic?: string
    video_type?: string
  }
  thematic_core?: string
  visual_strategy?: {
    asset_harmonization?: string
    cinematic_sandbox?: string
    evolution_arc?: string
    resource_scope?: {
      essential_b_roll?: string[]
      primary_stages?: string[]
    }
  }
  world_physics?: {
    global_motion_paradigm?: {
      base_momentum?: string
      dominant_movement_axis?: string
    }
  }
}

export const LONG_TAKE_VISUAL_SCRIPT_CONFIG = {
  baseline: {
    minWords: 6,
    maxWords: 12,
  },
}

export type LongTakeVisualScriptConfig = typeof LONG_TAKE_VISUAL_SCRIPT_CONFIG

export function buildLongTakeLegacyVisualScriptPrompt(params: {
  config?: LongTakeVisualScriptConfig
  globalConstraints: Record<string, unknown>
  notes?: string[]
  perfectLoop?: boolean
  script: string
}): string {
  const {
    globalConstraints,
    notes,
    perfectLoop = false,
    script,
    config = LONG_TAKE_VISUAL_SCRIPT_CONFIG,
  } = params
  const globalConstraintsJson = JSON.stringify(globalConstraints, null, 2)
  const notesJson =
    notes && notes.length > 0 ? JSON.stringify(notes, null, 2) : JSON.stringify([], null, 2)
  const perfectLoopNote = perfectLoop
    ? `
Perfect Loop Constraint:
- This video must be a perfect loop; the final frame should match the first frame.
- Make the final shot slightly longer than surrounding shots to allow a cleaner loop transition.
`
    : ''

  return `Role:
You are a careful, observant visual storyteller who specializes in the "Show, Don't Tell" principle, drawing on shared human experience and cultural reference to translate complex ideas into concrete, watchable visuals.

Input:
A finalized Voice-Over Transcript (VO).
A Global Rule JSON (based on overall understanding of video creation intents).
User Intent Notes (additional constraints extracted from the user's request).

Objective:
Preserve the Voice-Over text verbatim. Do not paraphrase, rewrite, or reorder.
Establish Global Visual Constraints (World Model) before generating shot-level visuals.
For every distinct audio beat (a shot-level VO segment), generate a visual plan that describes concrete, visible elements that can be filmed or generated.
Each visual description must be grounded in observable reality and serve the narrative intent.
You MUST honor the User Intent Notes as high-priority constraints for what the visuals should include or avoid.
Notes prefixed with [ASSET INTENT] are hard constraints from the user about how their uploaded assets should be used. These MUST be respected in the visual script and take priority over your creative judgment about asset placement.

Step 1: The World Model (Visual Translation)
Translate the provided Global Rule JSON into specific visual directives.
Context: Adapt tone, geo_scope, and time_scope into specific lighting, texture, and setting rules.
Consistency: Use key_entities / brand_scope to enforce continuity (Object Permanence).
Requirements: Honor every item in directives -- these are the user's required positive elements; each must be realized somewhere in the shots.
Constraints: Adhere strictly to must_not_violate.

Step 2: Conceptual Framework - Four Visual Expression Types (Meaning Layer)
A single audio beat represents one Expression Type. Decide how the meaning becomes visible:
Literal / Direct: Show the person or thing mentioned in the Voice Over itself. Lowest ambiguity. Use when Voice Over names concrete people, objects, or places. Identity Priority: If a specific person is named (e.g., "Elon Musk"), the visual must feature their face/likeness to establish identity. Do not obscure them with hands-only or over-the-shoulder shots unless the identity is already established. Editorial Principle - Chronology: If the line involves history, the visual must match the Era.
Cultural Context / Worldview: Show the human reality or societal value implied by the idea.
Definition: Do not show the specific subject; show the world around it. The visual establishes a "Value Orientation" (e.g., freedom, chaos, progress, intimacy).
Mechanism: Use Implication rather than Illustration. Show how the concept affects people, culture, or the broader world.
Relationship: The VO acts as abstract commentary on the visual world presented.
Symbolic / Abstract: Show meaning through formal sign systems: data, diagrams, UI. The image must be "read."

**Expression Type Distribution Guideline (Reference Only):**
Prefer Literal > Symbolic > Cultural Context
Suggested distribution across the full video: Literal 44%, Symbolic 44%, Cultural Context 12%
This is a guideline, not a hard rule-adjust based on the specific content and narrative needs of each beat.

Step 3: Aesthetic Mode - Visual Tools & Syntax (Execution Layer)
Choose a visual presentation form to realize the selected Expression Type. Produce a freeform description of strictly diegetic elements. You have creative freedom to select specific elements, grounding every detail in observable physical reality. Center your description around the Modal Syntax:
A) Live Action / Observable Reality
Best for: Literal, Cultural Context
Strength: Human presence, real-world scale, physical texture, lived-in environments.
Boundary: Ground the image in recognizable physical logic.
Recommended Modal Syntax: [Subject] performing [Action] in [Setting].
Focus: People and physical objects moving through physical space (Lens-based).
B) Composited / Graphic Reality
Best for: Literal, Symbolic
Strength: Clarity + rhythm + conceptual compression.
Boundary: Composition should serve the idea and story.
Recommended Modal Syntax: [Subject/Graphic Object] performing [Motion] on [Canvas].
Focus: Collage, typography, or icons transforming against a stylized backdrop.
C) UI / Infographic Reality
Best for: Symbolic (Claims, Data, Processes).
Strength: Trust, legibility, argumentation.
Boundary: Keep it generic or brand-consistent.
Recommended Modal Syntax: [Data Visualization] demonstrating [Relationship/Progression] within [Interface].
Focus: Charts, counters, or UI elements evolving to show proof.

**Aesthetic Mode Distribution Guideline (Reference Only):**
Suggested distribution across the full video: Live Action 40%, Composited Graphic 40%, UI-Infographic 20%.
This is a guideline-let the Expression Type and content naturally guide mode selection for each beat.

Universal Constraint (The Diegetic Reality Standard):
Define the visual as a single, unbroken span of physical reality.
Temporal Linearity: Treat the visual as a continuous window into a timeline that moves strictly forward without interruption. Strictly Forbidden Vocabulary: Montage, Sequence, Match-Cut, Jump-Cut, Rapid Cuts. (You must describe a single continuous take).
Physical Stability: Maintain the structural integrity of objects. Ensure elements evolve only through natural mechanics (movement, lighting, physics).
Frame Unity: Compose the image within a single, unified environment. Resolve comparisons through compositional interaction (e.g., placing objects side-by-side) or by juxtaposing contrasting elements within the same physical space (e.g., a modern laptop sitting on an antique desk).
Optical Reality: Define perspective strictly by the Subject's scale and position. Prioritize Identity (faces) for people and Texture for objects. Describe the visibility of details (e.g., "The texture of the coin becomes visible") to imply focus.
Typography: if text must appear, it must occupy dominant visual area as the frame's primary anchor - a single bold word, large number, or prominent identifier. Never describe multiple small text items distributed as supplementary labels, tags, or icon captions.
On-Screen Text Language (CRITICAL): Visual prose (description / actions / atmosphere) MUST be written in English for downstream model compatibility. HOWEVER, any text that will visibly appear on the frame - signage, headlines, captions, disclaimers, brand names, UI strings, posters, quoted words, large typographic anchors - MUST be written in the SAME language as the input Voice-Over script and wrapped in single quotes inside the description. Examples (script in Spanish): "...a hospital sign reading 'Urgencias' above the doors..."; "...the disclaimer 'Este contenido es solo informativo' fades in..."; "...large bold word 'GASLIGHTING MÉDICO' shatters in a dark void...". Never silently translate on-screen text to English.

Step 4: Shot Segmentation (Visual-First) + Shot-Level Visual Design
Terminology:
In this prompt, an "audio beat" is one shot-level VO segment.

What is a shot (Responsibility):
A shot is one "visually expressible" unit: one core on-screen state (core_description) plus optional motion leading into/out of it (entry_action / exit_action).
Across the top-level "shots" array, shots must form an ordered, non-overlapping partition of the Script (verbatim, contiguous spans).

Step 4A: Shot Segmentation (Visual-First)
Before writing any visuals, silently segment the Script into a sequence of shots. Do NOT output intermediate steps; output only the final JSON object with a top-level "shots" array.

First Principle (must follow):
First answer: "What visual expression will carry this VO span?" Then decide cut points.
Cut points are driven by visual expression changes, not grammar alone.

Hard Rules (no exceptions):
- Verbatim: Each shot's audio must be copied verbatim from the Script.
- Partition: The shots' audio spans must cover the entire Script exactly once, in order (no omissions, no overlaps, no duplicates, no reordering).
- Safe boundaries: Prefer natural spoken boundaries; do NOT split inside names, numbers, or short fixed phrases.

Visual-First Heuristics (how to choose cut points):
- Visual intent priority: Cut when the visual expression would need to change materially, e.g.:
  - Subject changes (who/what we're watching)
  - Setting/era changes
  - Symbol system changes (Live Action ↔ UI/Infographic ↔ Composited Graphic)
  - Causal stage changes (cause → mechanism → result)
  - Perspective shift (macro → micro, abstract → concrete, claim → proof)
- Long sentence split: If a sentence is too long to fit cleanly, split by clause boundaries that map to separate visual expressions.
- Short sentence merge: If a sentence is too short to stand alone visually, merge with adjacent text only if it preserves a single visual expression unit.
- Rhythm consistency: Avoid many near-min-length shots in a row unless the VO is intentionally punchy.

Recommended Length Target (strong preference, not a hard rule):
- Word count is computed by splitting on whitespace (regex \`\\s+\`).
- Aim for MOST shots to fall within **${config.baseline.minWords}-${config.baseline.maxWords} words**.
- Allow only a small number of out-of-range shots when required for semantic completeness or natural spoken boundaries.
- If you create an out-of-range shot, add a visual.notes item: "Length exception: <brief reason>".
${perfectLoop ? `- Perfect Loop Tip: When possible, bias the FINAL shot's audio toward the upper end (${config.baseline.maxWords} words) to support a slightly longer final shot for cleaner looping.` : ''}

Step 4B: Shot-Level Visual Plan
For each shot, produce one visual object with three temporal phases:
- **core_description** (required): The peak visual state - the most representative moment. Be detailed and vivid: include subject, action, environment, lighting, texture, and atmosphere.
- **entry_action** (recommended): How the shot BEGINS - the full visual progression during the first half (~1-3s). Describe camera movement, subject motion, environmental changes, and how the scene builds toward the core moment. The richer the entry, the more dynamic the final video.
- **exit_action** (recommended): How the shot ENDS - the full visual progression during the second half (~1-3s). Describe how the scene evolves away from the core state. Include camera pulls, subject movement, lighting shifts, or compositional changes.
Omit entry/exit only for truly static shots. For most shots, provide rich descriptions sized to the available 2-10s of screen time, with 5-8s as the preferred rhythm.

${buildLegacyPositionRules(perfectLoop)}

Visual Complexity by Shot Length (Guidance):
Short shots (1-${config.baseline.minWords - 1} words): Simple, bold imagery with immediate impact. Single focal point.
Medium shots (${config.baseline.minWords}-${config.baseline.maxWords} words): Balance clarity and detail; can show progression.
Long shots (>${config.baseline.maxWords} words): Richer visual narrative; consider evolving focus or scene development.
${perfectLoopNote}

Step 5: Visual Script Generation
For each audio beat, produce a complete visual plan. Each description must be a single, continuous moment in a single location.

Output Format
Return an array of visual plan objects, one for each audio beat (shot-level VO segment).
Each object in the array must include:
- audio: the exact shot-level Voice-Over segment (verbatim; contiguous span from Script)
- visual: a structured visual plan

The visual plan must be an object with the following required fields:
core_description: The peak visual state for keyframe generation. Describe only what the viewer sees on screen at the most representative moment. Use the Core Components of the Modal Syntax from Step 3 to ensure clarity.

${buildLegacyOutputFormatRules(perfectLoop)}

Example Output JSON
[
  {
    "audio": "This feature reduces loading time.",
    "visual": {
      "core_description": "A clean, generic app interface displays a horizontal loading bar at approximately 60%, visibly accelerating.",
      "entry_action": "A loading bar starts at 20%, filling with visible momentum, then beginning to accelerate noticeably.",
      "exit_action": "A loading bar rushes from 70% toward 100%, completing almost instantly."
    }
  },
  {
    "audio": "The titanium casing makes it lighter than steel.",
    "visual": {
      "core_description": "A close-up of the raw titanium metal frame reflecting studio lights, emphasizing the brushed material texture.",
      "entry_action": "Camera pushes toward the titanium frame as light begins to sweep across its surface.",
      "exit_action": "Light completes its sweep across the metal, camera stays fixed on the gleaming texture."
    }
  }
]

Global Rule JSON:
${globalConstraintsJson}

Script:
${script}

User Intent Notes:
${notesJson}
`
}

export function buildLongTakeVisualScriptPrompt(params: {
  assetManifest: LongTakeAssetManifestOutput
  beatSheet: LongTakeBeatSheetOutput
  /** Dynamic prefers shorter shots (3-6s); Calm or absent keeps 5-8s. */
  cameraStyle?: CameraStyle
  config?: LongTakeVisualScriptConfig
  globalConstraints: Record<string, unknown>
  // Pre-serialized music context (genre / bpm / sections) for the 'music' route. Passed as a string
  // so this shared prompt builder stays decoupled from the story-mode-runtime music-context type.
  musicContextJson?: string
  perfectLoop?: boolean
  promptRoute?: LongTakePromptRoute
  script: string
  /**
   * Accepted for call-site stability but intentionally unused: planning is
   * model-agnostic -- every model gets the same visual-script
   * prompt.
   */
  transitionVideoModel?: string
  userAssetContent: Pick<
    LongTakeUserAssetsAnalysisOutput,
    'characters' | 'files' | 'mandatory_user_upload_bindings' | 'objects'
  >
  userPrompt?: string
  worldBible: LongTakeWorldBibleOutput
}): string {
  const {
    assetManifest,
    beatSheet,
    globalConstraints,
    musicContextJson,
    perfectLoop = false,
    promptRoute,
    script,
    userPrompt,
    userAssetContent,
    worldBible,
    config = LONG_TAKE_VISUAL_SCRIPT_CONFIG,
  } = params

  const beatSheetJson = JSON.stringify(
    {
      beat_sheet: beatSheet.beat_sheet.map((b) => ({
        beat_id: b.beat_id,
        segment_text: b.segment_text,
        duration: b.duration ?? null,
      })),
    },
    null,
    2,
  )
  const assetManifestJson = JSON.stringify(assetManifest, null, 2)
  const worldBibleJson = JSON.stringify(worldBible, null, 2)
  const userAssetContentJson = JSON.stringify(userAssetContent, null, 2)
  const globalConstraintsJson = JSON.stringify(globalConstraints, null, 2)
  const mandatoryUserUploadBindingSection = renderMandatoryUserUploadBindingSection(
    userAssetContent.mandatory_user_upload_bindings,
  )
  const allowedAssetIds = JSON.stringify(
    assetManifest.asset_manifest.map((item) => item.asset_id),
    null,
    2,
  )
  const evolutionArc =
    worldBible.visual_strategy?.evolution_arc ||
    'No arc defined - plan your own 3-act visual journey.'

  const perfectLoopNote = perfectLoop
    ? `
Perfect Loop Constraint:
- This video must be a perfect loop; the final frame should match the first frame.
- Make the final shot slightly longer than surrounding shots to allow a cleaner loop transition.
`
    : ''

  if (promptRoute === 'music') {
    // The music route needs each beat's time_range so the model can map beats onto the Music Context
    // sections (verse/chorus/drop) and the locked musical cut timing. The shared beatSheetJson above
    // omits time_range, so build a music-specific one that includes it.
    const musicBeatSheetJson = JSON.stringify(
      {
        beat_sheet: beatSheet.beat_sheet.map((b) => ({
          beat_id: b.beat_id,
          duration: b.duration ?? null,
          segment_text: b.segment_text,
          time_range: b.time_range ?? null,
        })),
      },
      null,
      2,
    )
    return buildMusicLongTakeVisualScriptPrompt({
      allowedAssetIds,
      assetManifestJson,
      beatSheetJson: musicBeatSheetJson,
      globalConstraintsJson,
      mandatoryUserUploadBindingSection,
      musicContextJson: musicContextJson ?? '{}',
      perfectLoop,
      script,
      userPrompt,
      userAssetContentJson,
      worldBibleJson,
    })
  }
  if (promptRoute === 'abstract') {
    return buildAbstractLongTakeVisualScriptPrompt({
      allowedAssetIds,
      assetManifestJson,
      beatSheetJson,
      globalConstraintsJson,
      mandatoryUserUploadBindingSection,
      perfectLoop,
      script,
      userAssetContentJson,
      worldBibleJson,
    })
  }
  if (promptRoute === 'ads-tangible') {
    return buildAdsTangibleLongTakeVisualScriptPrompt({
      allowedAssetIds,
      assetManifestJson,
      beatSheetJson,
      globalConstraintsJson,
      mandatoryUserUploadBindingSection,
      perfectLoop,
      script,
      userAssetContentJson,
      worldBibleJson,
    })
  }
  if (promptRoute === 'ads-intangible') {
    return buildAdsIntangibleLongTakeVisualScriptPrompt({
      allowedAssetIds,
      assetManifestJson,
      beatSheetJson,
      globalConstraintsJson,
      mandatoryUserUploadBindingSection,
      perfectLoop,
      script,
      userAssetContentJson,
      worldBibleJson,
    })
  }
  const shotDurationGuidance = visualScriptShotDurationGuidance(params.cameraStyle)

  const generalPrompt = `Role:
You are a careful, observant visual storyteller who specializes in the "Show, Don't Tell" principle, drawing on shared human experience and cultural reference to translate complex ideas into concrete, watchable visuals.

Input:
A finalized Voice-Over Transcript (VO) segmented into a beat sheet (one beat = one shot).
A Global Rule JSON (based on overall understanding of video creation intents).
A World Bible JSON (cinematic world-building context, thematic core, and evolution arc).
An Asset Manifest JSON (characters and props with stable IDs).
User Asset Content JSON (user-uploaded asset metadata).
Anchor Asset Images (attached as multimodal content, each preceded by an [asset_id: ...] label - use these to understand the visual appearance of each asset). These bracketed labels are for your internal reference only: NEVER copy [asset_id: ...], [file_id: ...], or [filename: ...] text into any output field, and in particular never into the voice-over / audio string - those fields are spoken aloud by TTS.

Objective:
Preserve the Voice-Over text verbatim. Do not paraphrase, rewrite, or reorder.
Establish Global Visual Constraints (World Model) before generating shot-level visuals.
For every beat in the beat sheet, generate a visual plan that describes concrete, visible elements that can be filmed or generated.
Each visual description must be grounded in observable reality and serve the narrative intent.

Universal Constraints (The Anti-Edit Protocol):
You must describe a Single Atomic Moment per shot. Do not describe editing techniques or temporal shifts.
- No Temporal Flow: Forbidden terms: "Time-lapse," "Rack focus," "Transitioning," "Morphing," "Fading."
- No Spatial Splitting: Forbidden terms: "Split screen," "Diptych," "Collage," "Montage."
- No Relative References: Forbidden phrases: "From the previous shot," "Continuing the action," "Similar to before." Each shot description must be fully self-contained.
- No Editing Tricks: Forbidden terms: "Match-cut," "Jump-cut," "Flashback."
- Avoid Incidental Text: Do not describe small annotations, map labels, corner date stamps, or stray entity captions. Typography is only appropriate when it occupies dominant visual area as the composition's primary anchor (a single bold headline or large identifier).

Step 1: The World Model (Visual Translation)
Translate the provided Global Rule JSON and World Bible into specific visual directives.
Context: Adapt tone, geo_scope, and time_scope into specific lighting, texture, and setting rules.
Consistency: Use key_entities / brand_scope to enforce continuity (Object Permanence).
Constraints: Adhere strictly to must_not_violate and creative_guardrails.

Story Arc Alignment:
The world bible defines the following evolution arc:
${evolutionArc}
Map each beat to a phase of this arc. Ensure visual variety escalates accordingly:
- Opening beats (Act 1): Establish the world. Clean, focused imagery. Build recognition.
- Middle beats (Act 2): Develop complexity. Introduce variety in expression types and aesthetic modes.
- Climax beats (Act 3): Peak visual density and engagement. The hero moment - maximum impact.
Do not repeat the same expression type or aesthetic mode for more than 3 consecutive shots.

Step 2: Conceptual Framework - Four Visual Expression Types (Meaning Layer)
A single audio beat represents one Expression Type. Decide how the meaning becomes visible:
Literal / Direct: Show the person or thing mentioned in the Voice Over itself. Lowest ambiguity. Use when Voice Over names concrete people, objects, or places. Identity Priority: If a specific person is named (e.g., "Elon Musk"), the visual must feature their face/likeness to establish identity. Do not obscure them with hands-only or over-the-shoulder shots unless the identity is already established. Editorial Principle - Chronology: If the line involves history, the visual must match the Era.
Cultural Context / Worldview: Show the human reality or societal value implied by the idea.
Definition: Do not show the specific subject; show the world around it. The visual establishes a "Value Orientation" (e.g., freedom, chaos, progress, intimacy).
Mechanism: Use Implication rather than Illustration. Show how the concept affects people, culture, or the broader world.
Relationship: The VO acts as abstract commentary on the visual world presented.
Symbolic / Abstract: Show meaning through formal sign systems: data, diagrams, UI. The image must be "read."

**Expression Type Distribution Guideline (strong preference):**
- Literal: ~45%, Symbolic: ~45%, Cultural Context: ~10%
- Adjust ±10% per type based on content needs
- DIVERSITY REQUIREMENT: Never use only one expression type for the entire video

Step 3: Aesthetic Mode - Visual Tools & Syntax (Execution Layer)
Choose a visual presentation form to realize the selected Expression Type. Produce a freeform description of strictly diegetic elements. You have creative freedom to select specific elements, grounding every detail in observable physical reality. Center your description around the Modal Syntax:
A) Live Action / Observable Reality
Best for: Literal, Cultural Context
Strength: Human presence, real-world scale, physical texture, lived-in environments.
Boundary: Ground the image in recognizable physical logic.
Recommended Modal Syntax: [Subject] performing [Action] in [Setting].
Focus: People and physical objects moving through physical space (Lens-based).
B) Composited / Graphic Reality
Best for: Literal, Symbolic
Strength: Clarity + rhythm + conceptual compression.
Boundary: Composition should serve the idea and story.
Recommended Modal Syntax: [Subject/Graphic Object] performing [Motion] on [Canvas].
Focus: Collage, typography, or icons transforming against a stylized backdrop.
C) UI / Infographic Reality
Best for: Symbolic (Claims, Data, Processes).
Strength: Trust, legibility, argumentation.
Boundary: Keep it generic or brand-consistent.
Recommended Modal Syntax: [Data Visualization] demonstrating [Relationship/Progression] within [Interface].
Focus: Charts, counters, or UI elements evolving to show proof.

**Aesthetic Mode Distribution Guideline (strong preference):**
Default preference: Live Action > Composited Graphic >>> UI-Infographic
- STRONGLY prefer Live Action when the script discusses concrete entities, people, or physical scenes. Live Action shots with anchor assets produce the best visual consistency.
- Use Composited Graphic sparingly for genuinely abstract concepts that cannot be shown in observable reality.
- UI-Infographic HARD CAP: <= 10% of total shots (e.g., max 1-2 shots in a 16-shot video). It is OK to be 0%.
- Do NOT use UI-Infographic or abstract graphics as a shortcut to avoid depicting a concrete subject. If the script talks about a seal diving, show the seal diving - do not show an abstract depth gauge.
- Do NOT use UI-Infographic in two adjacent shots.
- DIVERSITY REQUIREMENT: Never use only one aesthetic mode for the entire video

Plausibility Gate (Live Action vs Composited Graphic):
If the visual requires anachronistic collision, overlay/collage language, or intentionally unreal physics, choose Composited Graphic even if subjects are real.

Universal Constraint (The Diegetic Reality Standard):
Define the visual as a single, unbroken span of physical reality.
Temporal Linearity: Treat the visual as a continuous window into a timeline that moves strictly forward without interruption. Strictly Forbidden Vocabulary: Montage, Sequence, Match-Cut, Jump-Cut, Rapid Cuts. (You must describe a single continuous take).
Physical Stability: Maintain the structural integrity of objects. Ensure elements evolve only through natural mechanics (movement, lighting, physics).
Frame Unity: Compose the image within a single, unified environment. Resolve comparisons through compositional interaction (e.g., placing objects side-by-side) or by juxtaposing contrasting elements within the same physical space.
Optical Reality: Define perspective strictly by the Subject's scale and position. Prioritize Identity (faces) for people and Texture for objects.
Typography: if text must appear, it must occupy dominant visual area as the frame's primary anchor - a single bold word, large number, or prominent identifier. Never describe multiple small text items distributed as supplementary labels, tags, or icon captions.
On-Screen Text Language (CRITICAL): Visual prose (description / actions / atmosphere) MUST be written in English for downstream model compatibility. HOWEVER, any text that will visibly appear on the frame - signage, headlines, captions, disclaimers, brand names, UI strings, posters, quoted words, large typographic anchors - MUST be written in the SAME language as the input Voice-Over script and wrapped in single quotes inside the description. Examples (script in Spanish): "...a hospital sign reading 'Urgencias' above the doors..."; "...the disclaimer 'Este contenido es solo informativo' fades in..."; "...large bold word 'GASLIGHTING MÉDICO' shatters in a dark void...". Never silently translate on-screen text to English.

Step 4: Shot Description Structure
${shotDurationGuidance.intro}
The visual description is split into three temporal phases:

${shotDurationGuidance.coreDescriptionRule}

${shotDurationGuidance.phaseRules}

${perfectLoop ? buildLoopPositionRules() : buildNonLoopPositionRules()}

Omit entry/exit only for truly static shots (e.g., a logo frame or a single data point). For most shots, provide rich entry and exit descriptions sized to the available screen time.

Scene Richness Rule:
Each shot description MUST go beyond character placement. Include at least one of the following environmental or atmospheric details:
- Lighting conditions (e.g., harsh spotlight, golden hour, dim fluorescent)
- Material textures (e.g., worn leather, wet pavement, frosted glass)
- Ambient elements (e.g., falling rain, moving smoke, scattered papers)
- Spatial context (e.g., crowded background figures, distant skyline, cluttered desk)
Do not write staging directions ("The Character stands in the Set"). Instead, paint the scene: describe what the camera SEES, including the environment around the characters.

Product Coverage Rule (promotional/commercial videos only):
If the video is primarily selling, demoing, or marketing a product, ensure >= 15% of shots are product-first visuals where the product is the clear primary subject.

Symbiosis Rule (Human-Object Interaction):
When a protagonist or narrator character exists and the script describes product usage, the character MUST be shown actively interacting with the product - not merely standing nearby.

Visual Complexity by Shot Length (Guidance):
${shotDurationGuidance.complexityRules}
${perfectLoopNote}

=== CRITICAL HARD CONSTRAINTS ===

1) Beat lock:
- You MUST create exactly one shot per beat.
- Output shot count MUST equal beat_sheet length.
- Shot order MUST match beat order.

2) Shot ID rule:
- shot_id MUST be exactly String(beat_id).
- Example: beat_id=1 -> shot_id="1".

3) Audio rule:
- audio for each shot MUST equal the corresponding beat segment_text verbatim.
- Do not reorder beats.

4) Visual alignment rule:
- Align each shot's visual description with its corresponding beat text without shifting earlier or later.

5) Asset binding rule:
- Each shot must include used_asset_id: string[].
- used_asset_id may ONLY contain IDs from the Allowed Asset IDs list below.
- Every asset ID in the list has a generated reference image (anchor) - use the attached anchor images to understand their visual appearance.
- IMPORTANT: If a shot's core_description depicts or references a character/object that exists in the asset manifest, you MUST include its asset ID in used_asset_id. This applies even if the depiction is stylized, graphic, or abstract - as long as the entity is recognizable, bind the anchor. The anchor image ensures visual consistency.
- Named-group reference rule: When the shot collectively references members of a named group from key_entities - via group nouns ("the girls", "the trio", "the band", "the crew"), the group's name itself ("the Comets"), bare plural pronouns referring to known members ("they", "them"), or numeral + plural ("three girls") that quantitatively matches a named group's roster - you MUST include EVERY member's asset ID in used_asset_id, not just the most-mentioned individual. Identify membership by cross-referencing key_entities (which may use the format "GroupName (Member1, Member2, Member3)") with each asset's proper_name field in the asset manifest. Example: if key_entities contains "The Comets (Ava, Bea, Cleo)" and the manifest has assets with proper_name "Ava", "Bea", and "Cleo", any shot whose core_description says "the girls cheer" or "three girls strike a pose" must include all three asset IDs. Do not omit a member just because the prose only spelled out one name.
- If no relevant asset is needed for a shot (e.g., pure landscape, abstract data visualization with no recognizable entities), output [].
- Prefer Live Action shots with anchor assets over abstract/graphic representations when the script discusses a concrete entity. Showing the actual character/object with its anchor reference produces better visual results than stylized abstractions.
${mandatoryUserUploadBindingSection}

6) Visual rule:
- visual must describe one coherent, continuous shot moment.
- No montage language.
- Keep object and character continuity aligned with world bible and constraints.

${perfectLoop ? '7) Perfect loop mode: provide both entry_action and exit_action for every shot when meaningful.' : '7) Position rules:\n- Non-loop mode: first shot entry_action should be null; last shot exit_action should be null.'}

8) Output format:
- Return JSON object only, with a top-level "shots" array.
- No markdown fences.
- No extra commentary.

Output schema:
{
  "shots": [
    {
      "shot_id": "1",
      "audio": "string",
      "used_asset_id": ["char_x", "prop_y"],
      "visual": {
        "core_description": "string",
        "entry_action": "string|null",
        "exit_action": "string|null"
      }
    }
  ]
}

Allowed Asset IDs:
${allowedAssetIds}

Script:
${script}

Beat Sheet JSON:
${beatSheetJson}

Asset Manifest JSON:
${assetManifestJson}

World Bible JSON:
${worldBibleJson}

User Asset Content JSON:
${userAssetContentJson}

Global Constraints JSON:
${globalConstraintsJson}

Reference config:
${JSON.stringify(config, null, 2)}
`

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt,
    promptRoute,
    templateName: 'visual-script',
  })
}

// Model-agnostic shot-duration guidance: every model plans against
// the same ~2-10s shot envelope. Model-specific generation behavior lives in
// the transition-generation stage, not planning. The preferred rhythm is 5-8s
// for the Calm camera style (the default transition model, Hailuo 3, makes
// clips of 5s or more, and fewer shots mean fewer chained clips) and 3-6s for
// Dynamic, which wants more keyframes and quicker pacing.
function visualScriptShotDurationGuidance(cameraStyle?: CameraStyle) {
  const dynamic = cameraStyle === 'dynamic'
  return {
    complexityRules: (dynamic
      ? [
          'Short shots (2-4s): Simple, bold imagery with immediate impact. Single focal point.',
          'Medium shots (3-6s): Balance clarity and detail; can show progression.',
          'Long shots (6-10s): Richer visual narrative; consider evolving focus or scene development.',
        ]
      : [
          'Short shots (2-4s): Simple, bold imagery with immediate impact. Single focal point. Use sparingly.',
          'Medium shots (5-8s): Balance clarity and detail; can show progression.',
          'Long shots (8-10s): Richer visual narrative; consider evolving focus or scene development.',
        ]
    ).join('\n'),
    coreDescriptionRule:
      '- **core_description** (required): The peak visual state - the most representative moment of this shot. This drives keyframe image generation. Be detailed and vivid: include subject, action, environment, lighting, texture, and atmosphere.',
    intro: `Each shot is usually 2-10 seconds long, with ${dynamic ? '3-6' : '5-8'} seconds as the preferred rhythm.`,
    phaseRules: [
      '- **entry_action** (recommended): How the shot BEGINS - the motion, camera movement, or visual evolution during the first half of the shot (~1-3s). This is NOT a brief hint; describe the full visual progression leading into the core state. Include camera movement, subject motion, environmental changes, and how the scene builds toward the core moment. The richer the entry, the more dynamic the final video.',
      '- **exit_action** (recommended): How the shot ENDS - the motion, camera movement, or visual evolution during the second half of the shot (~1-3s). Describe how the scene evolves away from the core state, preparing for the next shot. Include camera pulls, subject movement, lighting shifts, or compositional changes.',
    ].join('\n'),
  }
}

/**
 * Build output format rules for entry/exit actions based on perfectLoop parameter.
 * Dynamically generates different requirements for loop vs non-loop mode.
 */
function buildLegacyOutputFormatRules(perfectLoop: boolean): string {
  if (perfectLoop) {
    return `The visual plan must also include (required for loop mode):
entry_action: How the shot begins or motion leading INTO the core state. Required for ALL shots.
exit_action: How the shot transitions OUT or motion leading away from the core state. Required for ALL shots.`
  }
  return `The visual plan should also include (position-dependent):
entry_action: How the shot begins or motion leading INTO the core state.
  - MUST be null for the FIRST shot in the output array
  - Optional but recommended for middle shots when motion exists
  - Omit if the shot is inherently static
exit_action: How the shot transitions OUT or motion leading away from the core state.
  - MUST be null for the LAST shot in the output array
  - Optional but recommended for middle shots when motion exists
  - Omit if the shot has no natural progression`
}

/**
 * Build position-specific rules for Step 5 based on perfectLoop parameter.
 * Dynamically generates different instructions for loop vs non-loop mode.
 */
function buildLegacyPositionRules(perfectLoop: boolean): string {
  if (perfectLoop) {
    // Loop mode: all shots need entry and exit actions
    return `**Position Requirements (Perfect Loop Mode):**
Since the video must loop perfectly (the last frame connects to the first frame), all shots must provide a complete three-stage description:
- **First shot**: Must provide \`entry_action\`, describing how to transition cleanly from the last shot.
- **Middle shots**: Must provide \`entry_action\` and \`exit_action\`.
- **Last shot**: Must provide \`exit_action\`, describing how to transition cleanly back to the first shot.

This ensures that the transition from the last shot to the first shot can use a complete exit→entry action chain.`
  }
  // Non-loop mode: first and last shots don't need certain fields
  return `**Position Requirements (Non-Loop Mode):**
The video has a clear beginning and end. The rules for the first and last shots are as follows:
- **First shot**: \`entry_action\` must be null or omitted. The video starts directly from the core state of this shot, with no "entry" transition.
- **Middle shots**: Must provide \`entry_action\` and \`exit_action\` (if there is motion).
- **Last shot**: \`exit_action\` must be null or omitted. The video ends at the core state of this shot, with no "exit" transition.

This ensures that the visual script is semantically consistent with the actual video structure.`
}

function renderMandatoryUserUploadBindingSection(
  bindings: LongTakeUserAssetsAnalysisOutput['mandatory_user_upload_bindings'],
): string {
  const assetIds = (bindings ?? [])
    .map((binding) => binding.asset_id.trim())
    .filter((assetId) => assetId.length > 0)

  if (assetIds.length === 0) {
    return ''
  }

  return `
Mandatory user-uploaded bindings:
- The user explicitly chose these brand-review upload asset IDs, so each ID MUST appear in used_asset_id for at least one closest-match shot: ${assetIds.join(', ')}.
- These IDs are allowed asset IDs. Treat this as an imperative binding requirement, not passive metadata.
- Choose the shot whose visual naturally shows the corresponding logo, product, or character; do not invent a disconnected shot only to satisfy the binding.`
}
