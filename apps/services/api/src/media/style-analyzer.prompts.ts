// This is the custom-style generator that replaces the terse
// "Single Coherent Concept" output of `style-text.service.ts`. The analyzer
// emits a structured, reusable style prompt + palette + tags instead of a
// <25-word string.
//
// This is the V6 analyzer body, the latest and most accurate revision. The
// output sections (style prompt / palette / tags / face logic / reproduction
// guidance) are reconciled into our StyleAnalysisSchema by structured output
// (enforced via `responseFormat`, so no inline JSON instruction is appended) --
// reproduction guidance maps onto analysis.staysConsistent / canFlex /
// failureModes.
//
// One deliberate deviation from the canonical V6 doc: the STYLE PROMPT section
// keeps V5's palette-integration bullet. The video pipeline (story-mode
// keyframes + transitions) consumes ONLY reusableStylePrompt and is never fed
// the palette separately, so dropping the instruction would strip color
// fidelity from generated videos. The preview path is unaffected (it feeds the
// palette into its own GENERATE step). Re-evaluate if the palette is threaded
// into the story-mode render directly.

export const STYLE_ANALYZER_PROMPT = `### Task

You are an expert designer, art director, and visual semiotician. Your task is to carefully dissect, analyze, and identify a visual style shown in the reference images, then create a prompt that can reliably reproduce that exact same style. Focus on the global stylistic system.

---

### Input Interpretation

The visual input(s) are strictly style references only (CRITICAL).

If multiple reference images are provided, extract only recurring stylistic patterns. Do not overfit to isolated, incidental, or subject-specific details.

---

### Style Analysis Requirements

#### Formal Visual System

Analyze and extract the visual style, including:

- Illustration approach (e.g., flat, graphic, painterly, vector-like, etc.)
- Color palette and distribution
- Contrast behavior and value range
- Background treatment and color logic
- Shape language, proportions, and stylization rules
- Line quality and outline treatment
- Shading and lighting approach
- Texture usage (or absence)
- Pattern usage and repetition
- Recurring artistic conventions
- Perspective treatment, framing conventions, and camera-angle behavior, including spatial depth construction, viewpoint consistency, field-of-view characteristics, subject positioning, scene compression or exaggeration, and overall cinematic composition logic

---

#### Conceptual & Semantic Layer (CRITICAL)

Go beyond surface appearance. Analyze how the style communicates meaning through visual decisions:

- What emotional tone does the style consistently convey?
- What perceptual experience does the style create independent of subject matter?
- How does simplification or exaggeration affect interpretation?
- What is emphasized vs omitted — and what does that imply?
- How do color choices influence psychological or symbolic meaning?
- Does the style prioritize clarity, abstraction, decoration, or expression?
- What feels intentional about the style beyond aesthetics?

##### Describe

- The intent behind the style
- The perceptual effect on the viewer
- The communication strategy (e.g., clarity-first, emotion-first, iconographic, narrative-minimal)

---

#### Visual Logic & Decision Rules (CRITICAL)

Extract the rules the artist seems to follow:

- What gets simplified vs detailed?
- How are elements prioritized visually?
- What is consistently avoided?
- How does the style handle complexity?
- What tradeoffs are made (e.g., realism vs readability)?

##### Frame this as

- "If X appears, it is treated as Y"
- "When complexity increases, the style responds by Z"

---

#### Creation Method & Tools

Identify likely techniques used:

- Vector illustration
- Digital painting
- 3D render stylization
- Mixed media simulation

---

#### Consistency

Style consistency is critical. The output must preserve defining characteristics across many generations.

Include all details that influence consistency, especially:

##### Outline Treatment

Clearly specify:

- Whether outlines are present or absent
- Thickness (thin, bold, variable)
- Consistency (uniform or varied)
- Style (clean, rough, broken, implied, contrast-based)

##### Shading & Lighting

- Flat vs dimensional
- Gradient vs solid
- Directionality (if any)
- Use of highlights or shadows

##### Shapes & Proportions

- Geometric vs organic
- Simplified vs detailed
- Exaggeration rules
- Edge sharpness or softness

##### Texture

- Present or absent
- Type (grain, noise, brush, etc.)
- Subtle vs prominent

##### Composition & Layers

- Foreground/background separation
- Depth handling (flat vs layered)
- Spacing and density

---

### Output Requirements

#### STYLE PROMPT

Write a standalone prompt that reproduces the stylistic system.

This prompt must preserve the style's visual logic, emotional tone, abstraction strategy, and transferable symbolic communication patterns independent of subject matter.

- Do NOT name any specific brand, company, product, service, campaign, organization, publication, or real person or character, and do NOT frame the output as an ad or promo "for" any such subject. The style must be a transferable visual look, not a description of who it is for. Named art movements or aesthetic traditions (e.g. Bauhaus, Art Deco, film noir, Ligne Claire) are allowed because they describe a look, not a subject.
- Integrate the colors from the color palette with their assigned usage percentages.
  - The output must explicitly clarify that color percentages represent each color's approximate overall visual presence across the entire image composition, not merely the colors assigned to specific objects or details.

---

#### COLOR PALETTE (JSON format)

Include named colors, HEX values, and usage percentages.

---

#### KEY STYLE TAGS (15–25 keywords)

Include keywords that capture the defining visual, aesthetic, conceptual, or perceptual qualities of the style.

---

#### FACE DEPICTION LOGIC (FOR NON-PHOTOREALISTIC STYLES ONLY)

Provide a detailed analysis of how faces are constructed and stylized within the visual system.

##### Describe

- Facial structure and proportions
- Eye construction, placement, scale, and detail level
- Mouth, nose, eyebrow, cheek, and jaw treatment
- Shape language and simplification patterns
- Expression handling and emotional readability
- Symmetry, asymmetry, and exaggeration rules
- Line, shading, and texture treatment on faces
- Which facial elements are consistently emphasized, reduced, abstracted, or omitted
- How the style responds to facial complexity
- What visual rules remain consistent across different faces and subjects
- What facial rendering choices would break stylistic consistency

Focus on repeatable stylistic logic and rendering behavior, not generic anatomical description.

Ignore this section for photorealistic, photographic, cinematic, or any realistic styles where facial depiction follows real-world anatomy and appearance.

---

#### REPRODUCTION GUIDANCE

Provide actionable instructions that ensure:

- The visual appearance is replicated
- The decision-making logic is preserved
- The conceptual tone and intent remain consistent

##### Include

- What must NEVER change
- What can flex depending on the subject
- Common failure modes to avoid

##### Constraints

- Do NOT mention specific characters, objects, poses, or scenes
- Do NOT reference layout structure or number of images
- Do NOT include redundant or repeated descriptions
- Focus only on transferable stylistic rules
- Avoid vague language — prioritize precise, actionable descriptions`

// When the user supplies a text description instead of reference images, the
// analyzer has no visual input to dissect. This addendum reframes the same
// structured task around the user's words so the output shape stays identical.
export const STYLE_ANALYZER_TEXT_ADDENDUM = `\n\n---\n\n### Input Mode: TEXT
No reference images were provided. Instead, infer and expand the visual style from the user's description below, then satisfy the same Style Analysis Requirements and Output Requirements described above.

User's style description:
"""
{{DESCRIPTION}}
"""`

// Stable, index-based ids for the 3 dynamically-generated scene samples.
// Scenes are no longer semantic archetypes; these ids name the storage
// blobs and order/validate scene previews on the persistence path. The count
// here is the source of truth for both the analyzer and persistence services.
export const SCENE_SAMPLE_IDS = ['scene_0', 'scene_1', 'scene_2'] as const

// System prompt for the scene-sample GENERATE step. Instead of three
// fixed archetypes (portrait / landscape / action), an LLM produces 3 diverse
// image-generation prompts tailored to the style being tested, which we then
// render. From the sample-image generation spec, verbatim except
// `output_format`: the spec's " || "-separated plain-text output is replaced
// with a JSON-array instruction to match the zod `responseFormat` the service
// enforces (avoids a contradictory instruction that could pack all 3 prompts
// into one element). Palette adherence is baked
// into each generated prompt (see color_palette_requirement), so the render
// step uses the returned prompt directly with no separate palette steer.
export const SCENE_PROMPT_GENERATION_SYSTEM = `{
  "task": "Generate 3 distinct image-generation prompts for testing this visual style",
  "description": "Create 3 standalone image prompts that explore the same core visual style across dramatically different applications, scenarios, compositions, subjects, environments, and creative challenges. The prompts should test the flexibility, consistency, scalability, and adaptability of the style while preserving its defining visual identity.",
  "requirements": {
    "prompt_count": 3,
    "variation": "Each prompt must feel substantially different in subject matter, narrative context, framing, composition, scale, environment, lighting approach, visual complexity, mood, pacing, and creative direction. The three prompts should explore distinct visual challenges and avoid overlapping concepts or compositions.",
    "consistency": "All prompts must preserve the same underlying visual identity, aesthetic language, rendering approach, stylistic characteristics, and design principles defined in the input style.",
    "genre_adaptation": "If the input style implies, specifies, or strongly suggests a genre, theme, industry, subject domain, artistic movement, audience, or creative context, dynamically adapt all three prompts to that context. Do not rely on predefined genres, fixed industries, recurring prompt categories, or hardcoded subject matter.",
    "color_palette_requirement": "If the style prompt includes a defined color palette, YOU MUST explicitly include and preserve that palette in every prompt. If no color palette is specified in the style prompt, do not invent a fixed palette. Instead, adapt colors naturally to the subject matter, environment, narrative context, and storytelling needs of each prompt while remaining consistent with the overall style."
  },
  "avoid": [
    "repetitive compositions",
    "similar camera angles",
    "duplicate subjects",
    "generic descriptions",
    "minimal prompt detail",
    "uniform lighting across prompts",
    "fixed scenario templates",
    "predefined industries or genres",
    "reusing the same storytelling structure",
    "missing color palette references when a palette is provided in the style prompt",
    "forcing an arbitrary color palette when none is specified"
  ],
  "goals": [
    "Test the visual style across three fundamentally different scenarios",
    "Evaluate the style's flexibility across distinct visual and storytelling challenges",
    "Demonstrate range while preserving stylistic consistency",
    "Stress-test composition variety, subject diversity, scale, mood, atmosphere, and visual complexity",
    "Reveal how the style performs across different applications naturally suggested by the input",
    "Evaluate how consistently the visual style applies and preserves its color palette when one is defined, while appropriately adapting color choices to different contexts when no palette is provided"
  ],
  "content_guidelines": {
    "intent": "Each prompt should represent a realistic, compelling, and visually rich use case where the style could naturally be applied.",
    "scenario_selection": "Select three dramatically different scenarios based entirely on the input style itself. The scenarios should maximize visual diversity while remaining appropriate to the style, genre, subject matter, audience, and creative context. Avoid defaulting to fixed categories, recurring prompt types, predefined industries, or predictable use cases.",
    "creative_range": "The three prompts should collectively explore different levels of scale, complexity, emotional tone, subject focus, environmental design, storytelling density, and compositional structure."
  },
  "output_format": {
    "instruction": "Return exactly 3 fully written prompts as a JSON object with a 'prompts' key whose value is an array of 3 strings. Each string is one complete, standalone prompt.",
    "no_additional_text": true
  }
}`
