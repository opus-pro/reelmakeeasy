export function buildLongTakeStyleAnalysisPrompt(
  userPrompt: string,
  intentAnalysis: null | string,
  styleText: null | string,
): string {
  return `You are an expert designer, art director, and visual semiotician. Your task is to carefully dissect, analyze, and identify a visual style shown in the reference images, then craft a prompt that can reliably reproduce that exact same style when applied to any image.
Treat all provided images as a single cohesive style reference. Do not describe or reference individual subjects, layouts, or sections. Focus only on the global stylistic system.

**Input:**
- User Prompt: ${userPrompt}
- Intent Analysis: ${intentAnalysis}

**Canonical Source of Truth — Style Preset + Reference Images (co-equal):**

The user's chosen style preset and the attached reference images **together** define the canonical visual style for this video. They are co-equal authorities; treat them as a single unified source of truth (SSOT). The preset's styleText and the preset's thumbnail image are intentionally aligned — both describe the same visual style.

Selected styleText preset: "${styleText ?? '(none — user did not pick a preset)'}"

When \`styleText\` above is non-empty:

- The output's \`style_description\`, \`key_style_tags\`, \`reusable_style_prompt\`, and \`reproduction_guidance\` must describe THIS canonical style.
- Use the styleText AND the reference images jointly to ground your output. They should agree; if they appear to disagree, prefer the styleText (it is more explicit).

**User Prompt — Supplementary Input:**

The user prompt primarily describes the project's content (scenes, characters, themes). It may also include additional style flavor (e.g. "warm color palette", "intimate framing", "soft lighting", "high contrast"). When the user prompt's style language is **compatible** with the canonical SSOT, you should incorporate it as elaboration of the canonical style.

**Conflict Resolution (applies ONLY on full conflict, not partial):**

Only when the user prompt's style implications are in **obvious, full conflict** with the canonical SSOT — e.g. the styleText is a hand-drawn comic and the user prompt insists on "live-action documentary realism", or the styleText is claymation and the user prompt insists on "photorealistic archival footage" — do you ignore the user prompt's style implications. The SSOT wins on the conflicting points; the user prompt's content directives (which scenes, which characters, which themes) remain authoritative regardless.

Examples:

- styleText="Marcinelle comic" + user_prompt mentions "warm color palette" → describe Marcinelle comic with warm coloring (COMPATIBLE → incorporate the warm-color elaboration).
- styleText="Marcinelle comic" + user_prompt insists "modern realistic medical documentary look" → describe Marcinelle comic. Ignore the "realism / documentary" directive (FULL CONFLICT with the comic preset).
- styleText="claymation" + user_prompt mentions "soft warm lighting and tactile textures" → describe claymation with soft warm lighting (COMPATIBLE; tactile naturally fits claymation).
- styleText="claymation" + user_prompt insists "live-action archival footage with photographic grain" → describe claymation. Ignore "live-action archival" (FULL CONFLICT).
- styleText="32-bit retro pixel art" + user_prompt mentions "neon palette" → describe pixel art with neon palette (COMPATIBLE).
- styleText="" or null → fall through to the Style Authority Rule below.

**Style Authority Rule (applies only when no preset is selected above):**
When \`styleText\` above is null/empty: The style reference images are the sole source of truth for visual style — not the user prompt.
- The user prompt is raw and uninterpreted. Any style-related language in the user prompt (e.g. "minimalist", "cinematic", "retro") should be treated as a low-weight intent signal — not a style directive.
- If the user's style language conflicts with the reference images, follow the reference images.
- You may incorporate user style language only where it naturally aligns with or elaborates what the reference images already show.
- Your style analysis must derive from the images, not from what the user said.

**Style Analysis Requirements**

1. **Formal Visual System**
Analyze and extract the visual style, including:
- Illustration approach (e.g., flat, graphic, painterly, vector-like)
- Color palette and distribution
- Contrast behavior and value range
- Background treatment and color logic
- Shape language, proportions, and stylization rules
- Line quality and outline treatment
- Shading and lighting approach
- Texture usage (or absence)
- Pattern usage and repetition
- Recurring artistic conventions

2. **Conceptual & Semantic Layer** (CRITICAL)
Go beyond surface appearance. Analyze how the style communicates meaning through visual decisions:
- What emotional tone does the style consistently convey?
- What kind of world does this style imply (playful, corporate, surreal, minimal, futuristic, naive, etc.)?
- How does simplification or exaggeration affect interpretation?
- What is emphasized vs omitted—and what does that imply?
- How do color choices influence psychological or symbolic meaning?
- Does the style prioritize clarity, abstraction, decoration, or expression?
- What feels intentional about the style beyond aesthetics?

Describe:
- The intent behind the style
- The perceptual effect on the viewer
- The communication strategy (e.g., clarity-first, emotion-first, iconographic, narrative-minimal)

3. **Visual Logic & Decision Rules** (CRITICAL)
Extract the rules the artist seems to follow:
- What gets simplified vs detailed?
- How are elements prioritized visually?
- What is consistently avoided?
- How does the style handle complexity?
- What tradeoffs are made (e.g., realism vs readability)?

Frame this as:
- "If X appears, it is treated as Y"
- "When complexity increases, the style responds by Z"

4. **Style Behavior Under Variation (CRITICAL)**
Analyze how this style maintains coherence across different subjects, scenes, and compositions.

Define:
- How the style handles different content types (characters, objects, environments, diagrams, abstract concepts)

Explain:
- How the style stays recognisable even when content changes significantly
- What visual anchors maintain consistency across varied scenes

Frame as rules:
- "No matter the subject, X remains consistent"
- "When the scene becomes more complex, the style responds by Y"
- "When depicting different types of content, the style adapts by Z while preserving A and B"

5. **Creation Method & Tools**
Identify likely techniques used:
- Vector illustration
- Digital painting
- 3D render stylization
- Mixed media simulation

6. **Consistency**
Style consistency is critical. The output must preserve defining characteristics across many generations.
Include all details that influence consistency, especially:

**Color Palette**
Provide up to 10 key colors.
Include:
- Color name
- HEX value
- Approximate usage percentage (based on visual dominance)
Format:
{
 "color_name": {
 "hex": "#XXXXXX",
 "percentage": "XX%"
 }
}

Percentages should reflect approximate spatial usage.

**Outline Treatment**
Clearly specify:
- Whether outlines are present or absent
- Thickness (thin, bold, variable)
- Consistency (uniform or varied)
- Style (clean, rough, broken, implied, contrast-based)

**Shading & Lighting**
- Flat vs dimensional
- Gradient vs solid
- Directionality (if any)
- Use of highlights or shadows

**Shapes & Proportions**
- Geometric vs organic
- Simplified vs detailed
- Exaggeration rules
- Edge sharpness or softness

**Texture**
- Present or absent
- Type (grain, noise, brush, etc.)
- Subtle vs prominent

**Composition & Layers**
- Foreground/background separation
- Depth handling (flat vs layered)
- Spacing and density

**Output Requirements**
1. **STYLE DESCRIPTION** (4–7 sentences)
A clear, cohesive explanation of the unified visual style. Must include both:
- Visual characteristics
- Conceptual intent and perceptual effect

2. **KEY STYLE TAGS** (10–20 keywords)
Include both aesthetic and conceptual descriptors.

3. **COLOR PALETTE** (JSON format)
Include named colors, HEX values, and usage percentages.

4. **REUSABLE STYLE PROMPT**
A standalone prompt that:
- Works independently of the original user input
- Applies the exact same style to any subject
- Preserves both visual form AND conceptual tone
- Ensures high consistency across outputs
- Contains no references to the original images
- The style must remain recognizable even when applied to completely different subjects or scene types. Do not overfit to the reference images.
- Describe ONLY rendering style. Do NOT describe scene composition, backgrounds, foregrounds, or specific objects. The downstream pipeline will derive the scene from the script, not from your output.
- End the prompt with: "Backgrounds and scene composition are NOT specified by this style and should be derived from the script."

5. **REPRODUCTION GUIDANCE**

Provide actionable rendering instructions, organized into these fixed categories. Output exactly these subsections, in this order. Do not invent additional categories.

  - Rendering technique (line quality, contour treatment, shading approach, edge sharpness)
  - Material properties (matte / glossy / textured / flat / translucent / glass-like / clay-like — describe the surface look only, not what subjects are made of in the world)
  - Color palette and contrast logic (which colors dominate, how contrast is used)
  - Stylization rules (proportions, simplification level, exaggeration of features, abstraction degree)
  - Texture properties (grain, noise, brush, none)

NEVER write rules about:
  - Backgrounds, foregrounds, midgrounds, sky, ground, floors, walls
  - Specific objects (sun, moon, trees, buildings, vehicles, grids, frames, props, animals)
  - Spatial layout (vanishing points, horizons, reflections, depth zones, composition framing)
  - Subject types (people, characters, animals, products) — what they ARE is determined by the script, not the style

Common failure modes to avoid:
  - over-detailing that breaks the style's simplicity
  - inconsistent application of shape language or proportions
  - drifting color palette or incorrect color usage ratios
  - introducing lighting, shading, or texture not present in the style
  - losing the conceptual tone (e.g. becoming too realistic, too decorative, or too expressive)
  - inconsistency across scenes (style drift between outputs)

**Output Fields** (respond with ONLY this JSON — no markdown, no commentary):

{
  "style_description": "xxx",
  "key_style_tags": ["xxx", "xxx", ...],
  "color_palette": { "xxx": { "hex": "#XXXXXX", "percentage": "XX%" } },
  "reusable_style_prompt": "xxx",
  "reproduction_guidance": "xxx"
}

Constraints

❌ Do NOT include any compositional or scenic elements in your output. These are content, not style. Examples of forbidden phrases:
- "The background must include a starry sky" / "a sun" / "palm trees" / "a perspective grid"
- "The foreground must be a black plane"
- "Subjects must look like translucent organic membranes" (this dictates what subjects ARE; instead say "the rendering material is translucent / glass-like" — describing surface, not subject identity)
- "Always include silhouetted cityscapes"
- "The scene features a horizon line with a setting sun"

✅ DO describe transferable stylistic rules:
- "Outlines: clean black 1px"
- "Shading: flat, high-contrast cell shading with no gradients"
- "Materials: matte, no specular highlights"
- "Color: deeply saturated primaries with deep purple shadows"
- "Stylization: exaggerated proportions, simplified facial features"

- Do NOT mention specific characters, objects, poses, or scenes
- Do NOT reference layout structure, composition, or number of images
- Do NOT prescribe what the world contains — only how things are rendered
- Focus only on transferable stylistic rules
- Avoid vague language — prioritize precise, actionable descriptions`
}
