/**
 * Phase B -- Anchor prompt-spec builder.
 *
 * Per anchor, compose a Nano Banana generation prompt that renders
 * the right reference-sheet shape for that candidate's branch:
 *
 * - `multi_angle`: a single, solitary image rendering THIS anchor's
 *   target view (front / profile / back / ...), derived from the anchor's
 *   label / anchor_id. The source image is an identity reference only --
 *   the branch does NOT reproduce the source's framing, so sibling angles
 *   each render as a DISTINCT image (mirrors story-mode's per-angle
 *   single-view generation). Used when the Plan LLM split a subject into
 *   one anchor per view.
 * - `singer_single_view`: a single 2:3 reference image for the canonical
 *   music-video singer anchor (`char_singer`). This avoids leaking a
 *   generated character-grid composition into downstream singing shots.
 * - `styled`: 2x2 four-view grid at 1:1 with the user-provided style
 *   text baked into the header template.
 * - `photoreal`: 2x3 six-view grid at 2:3 as a "studio ground truth"
 *   reference sheet (IGNORES world_bible style; photoreal is the
 *   structural reference the downstream keyframe/video gen will
 *   stylize later).
 *
 * Character and Prop candidates use different view sequences inside
 * each branch, mirroring story-mode's `buildLongTakeAssetManagerExpertPrompt`.
 */

import type { AnchorAssetCandidate, AssetDescriptionsArtifact } from '../types'

export type AnchorPromptBranch = 'multi_angle' | 'photoreal' | 'singer_single_view' | 'styled'

export type AssetDescriptionItem = AssetDescriptionsArtifact['items'][number]

/**
 * Pick the reference-sheet branch for a candidate given the session's
 * effective style text. Shared with Phase C (`resolveAnchorAspectRatio`)
 * so the Phase B prompt text and the Phase C aspect parameter cannot
 * drift apart.
 */
export function resolveAnchorBranch(
  candidate: AnchorAssetCandidate,
  effectiveStyleText: string,
): AnchorPromptBranch {
  if (candidate.is_multi_angle) {
    return 'multi_angle'
  }
  if (isCanonicalSingerAnchor(candidate)) {
    return 'singer_single_view'
  }
  return effectiveStyleText.trim() ? 'styled' : 'photoreal'
}

function isCanonicalSingerAnchor(candidate: AnchorAssetCandidate): boolean {
  return candidate.type === 'CHARACTER' && candidate.anchor_id === 'char_singer'
}

const CHARACTER_PHOTOREAL_SHOTS = [
  'a hero headshot',
  'a high-angle 3/4 portrait',
  'a low-angle full body shot',
  'a side profile view',
  'an off-axis reaction shot',
  'a front orthographic face detail shot',
]

const PROP_PHOTOREAL_SHOTS = [
  'a hero product shot',
  'a front elevation view',
  'a side profile view',
  'a top-down view',
  'an isometric view',
  'a detailed close-up',
]

const CHARACTER_STYLED_SHOTS = [
  'a front full-body view',
  'a side profile view',
  'a 3/4 view',
  'a back view',
]

const PROP_STYLED_SHOTS = ['a front view', 'a side view', 'a top-down view', 'a detail view']

// The styled branch is the DEFAULT path (resolveAnchorBranch routes here for
// any non-empty style text). The Shared Output Requirements below DO carry
// "no dynamic narrative environment", but that instructs the Phase B AUTHOR --
// the image model reads only generation_prompt plus a code-appended suffix, and
// nothing validates the author carried it through. photoreal survives because
// its header template hard-codes a backdrop the author must reproduce; styled
// had no such anchor point, so an uploaded photo's room followed the subject
// into the four-view grid.
//
// The field is ENFORCED as light grey rather than left to the style. A
// reference sheet's job is to be a predictable matte for downstream keyframe
// and video generation, and "a uniform backdrop in the stated visual style"
// leaves the colour to the model -- so two anchors in one project can disagree.
// This mirrors the reference sheets the art direction asks for ("a plain
// light-grey field").
//
// The style/backdrop split is stated explicitly because styles are written for
// SCENES: blue-collage names "a powder-blue background" and
// handcrafted-miniature allows "vast forests to indoor kitchens to abstract
// voids" with tilt-shift depth separation. None of that governs a reference
// sheet's field, so the clause says so outright instead of deferring to it.
// Verbatim blocks, for the same reason as ANCHOR_LIGHT_GREY_FIELD: a constraint
// that only instructs the Phase B author is a REQUEST, not a guarantee. The
// codebase already documents one instance of the author silently dropping a
// rule (anchor-image-gen.ts:493-499, the Invented-Text Protocol) and works
// around it with a code-appended suffix. These follow that precedent.
//
// Ported from the art direction's character/prop sheet templates, with two
// deliberate omissions and two scoping decisions:
//   - "no grid, no separating lines or panels between figures" is NOT included.
//     The 2x2 grid is a decided product choice; dropping it is a separate call.
//   - Neutral expression is styled-only. photoreal's own shot_list contains
//     "an off-axis reaction shot", and singer_single_view exists to carry lip
//     sync -- forcing a closed mouth would defeat both.
//
// NOTE on ORDER: an aspect flag (--ar) must be the LAST token in the assembled
// prompt. The layout blocks therefore do NOT carry it; each branch brief appends
// its own aspect token AFTER these constraints. Appending constraints after a
// block that ended in "--ar 1:1" left the flag mid-string with text trailing it.
//
// NOTE on wording: the field says "isolated identity reference", NOT "reference
// sheet". SINGLE_VIEW_LAYOUT_BLOCK explicitly BANS the term "reference sheet",
// so a shared constant using it hands multi_angle and singer_single_view two
// contradictory instructions in adjacent sentences. Do not "improve" this back.
const ANCHOR_NO_MARKS = 'No captions, no numbers, no arrows.'

// Grid branches only -- a single-view branch has no sibling views to match.
function anchorSubjectCleanliness(isCharacter: boolean): string {
  return isCharacter
    ? 'No props and no accessories beyond the described costume.'
    : 'No hands, no people, and nothing beyond the described object.'
}

function anchorViewConsistency(isCharacter: boolean): string {
  return isCharacter
    ? 'Identical face, hair, proportions, and outfit in every view -- the same character repeated, not variations.'
    : 'Identical shape, materials, colors, and proportions in every view -- the same object repeated, not variations.'
}

// styled only -- see the scoping note above.
const ANCHOR_NEUTRAL_PRESENTATION =
  'Neutral facial expression, mouth closed, relaxed posture, neutral standing pose.'

const ANCHOR_LIGHT_GREY_FIELD =
  'Background: a solid, clean light-grey field -- this is an isolated identity reference, not a scene. ' +
  'The stated visual style governs how the SUBJECT is rendered, never the backdrop. ' +
  'Carry over no environment, furniture, or location cues from any source image.'

const PHOTOREAL_LAYOUT_BLOCK = `Composition: A seamless 2x3 image grid containing exactly 6 panels. Layout: 2 Columns, 3 Rows. Visual Continuity: Subject and wardrobe must be 100% identical across all panels. Zero padding, zero gutters, no white space, contiguous image. no text, no labels, no typography, no watermarks. High-Fidelity, 8k. ${
  ANCHOR_LIGHT_GREY_FIELD
}`

const STYLED_LAYOUT_BLOCK = `Composition: A seamless 2x2 image grid containing exactly 4 panels. Layout: 2 Columns, 2 Rows. Visual Continuity: Subject must be recognizable across all panels. ${
  ANCHOR_LIGHT_GREY_FIELD
} Zero padding, zero gutters, no white space, contiguous image. no text, no labels, no typography, no watermarks.`

// Single solitary view (multi-angle branch). Mirrors story-mode's
// long-take asset-manager multi-angle layout: one subject, one frame,
// explicitly NOT a grid / turnaround / model sheet. Crucially it does
// NOT tell the model to "match the source image's framing" -- the source
// is an identity reference only, and the target view comes from the
// shot_list, so each sibling angle renders as a distinct image instead
// of all reproducing the same uploaded model sheet.
const SINGLE_VIEW_LAYOUT_BLOCK = `Composition: A single, solitary image of the subject in one continuous frame. STRICT NEGATIVE CONSTRAINTS: do NOT render a grid, collage, panel layout, split view, multi-view sheet, reference sheet, contact sheet, storyboard, diptych, triptych, or any composition containing multiple poses, angles, or sub-images. Exactly one image of the subject, nothing else. High-Fidelity, 8k. ${
  ANCHOR_LIGHT_GREY_FIELD
}`

/**
 * The project's own business facts, used only by the no-source branch.
 *
 * A generated-from-scratch anchor has no reference image, so every legible
 * mark on it is invented. Without these facts the model fills a blank
 * text-bearing surface with whatever is statistically common for that prop
 * -- e.g. a door flyer in a home-services ad became a "NEIGHBORHOOD PIZZA"
 * ad. Supplying the facts
 * gives correct copy a source; the Invented-Text Protocol below forbids
 * inventing any other.
 */
export interface AnchorBusinessContext {
  aboutUs?: null | string
  businessName?: null | string
  keyEntities?: string[]
  targetAudience?: null | string
  topic?: null | string
}

export function buildAnchorPromptSpecPrompt(params: {
  anchor: AnchorAssetCandidate
  assetDescriptions: AssetDescriptionItem[]
  /**
   * Project business facts. Only consumed by the no-source branch; the
   * has-source branch already derives copy from the reference image.
   */
  businessContext?: AnchorBusinessContext | null
  editInstructions: string[]
  effectiveStyleText: string
  hasPreviousGeneratedAnchorPreviewHint: boolean
  hasSourceImages: boolean
  /**
   * Optional voice character hint. When this anchor is the narrator /
   * main-character, the voice description soft-biases gender / age /
   * demeanor in the visual_reference. Story-mode does not inject voice
   * info at this level (only at the asset manifest level), so this is a
   * UIP-specific reinforcement that helps when anchor_asset_manager
   * already qualified the narrator anchor without baking gender into
   * the visual_reference text.
   */
  voiceCharacterText?: string
  worldBibleJson: string
}): string {
  // Substitute [SUBJECT] once, up front, so every consumer below (the branch
  // brief's header templates and the Effective Style Text block) sees the same
  // resolved text. resolveAnchorBranch keeps the RAW value -- it only tests
  // emptiness, which substitution cannot change.
  const effectiveStyleText = substituteStyleSubject(params.effectiveStyleText, params.anchor)
  const normalizedStyleText = effectiveStyleText.trim() || 'none'
  const businessContextSection = renderBusinessContextSection(params.businessContext)
  const branch = resolveAnchorBranch(params.anchor, params.effectiveStyleText)
  const branchBrief = buildBranchBrief({
    branch,
    candidateType: params.anchor.type,
    styleText: effectiveStyleText,
  })

  const sourceSection =
    params.assetDescriptions.length > 0
      ? `Source Asset Descriptions:
${JSON.stringify(params.assetDescriptions, null, 2)}

Reference Interpretation:
- The first attached source image is the canonical hero reference.
- Any additional attached source images are complementary angles or detail references for the same anchor.

User Asset Protocol (HARD, unless otherwise prompted by the Requested Edit Instruction):
- Preserve and explicitly include ALL observable appearance details from the source images and visual_reference.
  - For CHARACTER: exact clothing (color, style, patterns), hairstyle (color, length, style), skin tone, accessories, held objects, footwear.
  - For OBJECT / PROP / PRODUCT: exact packaging text (verbatim, including brand name, product name, taglines, weights/counts), color scheme (primary + accent, finish), shape / form factor, material appearance, logos / icons / illustrations on the surface, typography choices.
- Do NOT omit or generalize any of these as "standard attire", "a product", "packaging", or similar placeholders.
- Never invent fake brand names, text, or logos. If text is illegible in the source, mark it as "[unreadable]" rather than fabricating.
- Lighting / composition / studio polish may be upgraded; the subject's design (character appearance OR product packaging) must remain the source image's design.${renderSubjectScopingLine(params.anchor)}

Edit Instruction Override (applies ONLY when "Requested Edit Instructions" is non-empty):
- The Requested Edit Instructions are explicit user-authorized requests to change this anchor. They are the only thing that may override the User Asset Protocol above. Apply them IN ORDER, oldest first: each instruction's named changes accumulate on top of the previous ones, and when two instructions name the same attribute the later one wins.
- Any attribute the edit instructions explicitly name (wardrobe, hair, accessories, posture, expression, age, gender, ethnicity, body type, props, anything else) is OVERRIDDEN. The instruction value replaces the source-image value for that exact attribute. Do not also carry the source value into the prompt as an alternative.
- Attributes the edit instructions do NOT name remain governed by the User Asset Protocol (preserved exactly from the source images). Do not invent new wardrobe / props / facial features that the edit instructions didn't request.
- When no Requested Edit Instructions are present, the User Asset Protocol applies in full and you must not change anything from the source images.`
      : `Source Asset Descriptions:
[]

No user-provided reference image is available for this anchor. Build a stable anchor reference concept from the anchor's visual_tag / visual_reference / keyword / proper_name, its continuity reason, and the world bible only. Keep the design plausible, minimal, and consistent with the world bible.

Invented-Text Protocol (HARD -- no reference image is attached, so every legible mark on this anchor is one you are inventing):
- Never invent a brand name, wordmark, logo, or company identity for this anchor. Do not place a brand-name lockup for any company the Business Context below does not name. When the Business Context does name the business and this anchor is meant to carry its branding, use that exact name as plain lettering, and do not design a logo mark for it.
- A surface that normally carries copy (flyer, poster, sign, banner, menu, label, packaging, book cover, card, screen) may show legible text ONLY when that text is supported by the Business Context section below or by this anchor's own visual_reference / proper_name. Quote it verbatim from that source.
- When no supported text exists, describe the surface's layout, material, and color instead, and state explicitly that any lettering is indistinct and non-legible. Do not fill a blank surface with plausible-looking real-world copy.
- Never borrow a real-world brand, product, or establishment unrelated to this project to dress an unspecified surface.${businessContextSection}`

  // The transform requested by the ORIGINAL user prompt leads the override
  // chain; user edits made later follow it and therefore win on any attribute
  // they both name. Reusing this chain is deliberate -- its Override block
  // already says an instruction REPLACES the source-image value on every
  // attribute it names, including wardrobe, which is exactly what a costume
  // transform needs. Before this, the only transform channel was
  // `edit_instructions`, and those are gated to scope === 'ANCHOR_IDS', so a
  // first-pass generation could never honor "make Sam a pirate" and rendered
  // the uploaded clothing instead.
  const promptTransform = params.anchor.prompt_transform?.trim()
  const orderedInstructions = [
    ...(promptTransform ? [`Render this subject as: ${promptTransform}`] : []),
    ...params.editInstructions,
  ]
  const numberedEditInstructions = orderedInstructions
    .map((instruction, index) => `${index + 1}. ${instruction}`)
    .join('\n')
  const editInstructionSection =
    orderedInstructions.length > 0
      ? `Requested Edit Instructions (apply IN ORDER, oldest first; a later instruction overrides an earlier one only on the attributes they both name -- otherwise every instruction's changes accumulate):
${numberedEditInstructions}`
      : 'Requested Edit Instructions:\nnone'

  const voiceCharacterSection =
    params.voiceCharacterText && params.anchor.type === 'CHARACTER'
      ? `Voice Character Hint:
${params.voiceCharacterText}
If this anchor represents the narrator / main on-screen speaker, prefer visual traits (gender, age range, build, demeanor) consistent with this voice description. If this anchor represents a music-video singer, rapper, or solo vocal performer for lip-syncable shots, its gender presentation and age cues MUST match this voice description when no source image or requested edit instruction explicitly overrides identity. Do not invent details beyond what the visual_reference and source images already establish.

`
      : ''

  return `Role: Anchor Asset Prompt Architect.

Objective:
Design a Nano Banana prompt for a reusable anchor asset reference image.
This is a UIP-local version of the story-mode asset-manager prompt-engineering step. The anchor image is a REFERENCE, not a video keyframe -- its aspect ratio and composition serve multi-angle recognition for downstream visual script and video generation.

The Source-of-Truth Stack
- If source images exist, source image truth comes first.
- If a previous generated anchor preview is attached, treat it only as a soft continuity hint.
- Never let the previous generated preview override attached source images or the requested edit instruction.
- Then apply world_bible continuity.
- Then apply the branch rules below.
- Never let style destroy identity, geometry, branding, or core physical cues that are visibly present in the source images.

Style Agnosticism (universal)
- NEVER describe the rendering style (e.g. "stylized", "photorealistic", "cartoon", "vector") as a freestanding label. The branch rules below handle medium selection. Describe only geometry, motion, and layout.

Branch Routing (pick ONE based on the anchor's is_multi_angle + anchor_id + effective style text):

${branchBrief}

Shared Output Requirements
- prompt_spec: a short explanation (1-3 sentences) of the intended anchor reference construction, including which branch was applied and why.
- generation_prompt: the final Nano Banana prompt assembled as:
  [header template filled in from visual_tag / visual_reference / keyword / proper_name]
  + " containing views of: " + [shot_list joined by ", "] + "."
  + " " + [layout block VERBATIM]
  (for the multi_angle or singer_single_view branch, IGNORE this grid assembly: follow that branch's own single-view assembly and single-view layout block instead)
- Apply the requested edit instructions in order when present. Per the Edit Instruction Override in the User Asset Protocol section rendered later in this prompt (alongside the Source Asset Descriptions), the edit instructions are user-authorized overrides that REPLACE the source-image value on every attribute they name (including wardrobe, hair, age, gender, ethnicity: anything at all); earlier and later instructions accumulate, and a later one wins on any attribute they both name. Attributes the edit instructions do not name stay preserved from the source image.
- Clean, neutral composition; no scene storytelling, no dynamic narrative environment, no extra characters.
- depicted_gender: "male", "female", or "unknown" -- the gender of the subject your generation_prompt actually depicts. This is a report of what you wrote, not a separate decision: it MUST match the subject in generation_prompt, and for a CHARACTER anchor it MUST match the Anchor's subject_gender unless a requested edit instruction or a source image overrides identity. This field is compared against the resolved gender by an automated check, and a mismatch is rejected and regenerated. Use "unknown" only for OBJECT anchors or when gender is genuinely not established. Reason about THIS anchor alone; other characters in the story are irrelevant to it.

Output JSON only:
{
  "prompt_spec": "Short explanation of the intended reference-sheet construction.",
  "generation_prompt": "Final image generation prompt.",
  "depicted_gender": "male | female | unknown"
}

Anchor:
${JSON.stringify(params.anchor, null, 2)}

${voiceCharacterSection}${sourceSection}

${editInstructionSection}

Has Source Images:
${params.hasSourceImages ? 'true' : 'false'}

Has Previous Generated Anchor Preview Hint:
${params.hasPreviousGeneratedAnchorPreviewHint ? 'true' : 'false'}

Attached Image Order:
- First: attached uploaded source images, if any
- Last: previous generated anchor preview, if present

Effective Style Text:
${normalizedStyleText}

World Bible JSON:
${params.worldBibleJson}`
}

function buildBranchBrief(params: {
  branch: AnchorPromptBranch
  candidateType: 'CHARACTER' | 'OBJECT'
  styleText: string
}): string {
  const isCharacter = params.candidateType === 'CHARACTER'
  if (params.branch === 'multi_angle') {
    const styleSuffix = params.styleText.trim() ? ` ${params.styleText.trim()}.` : ''
    return `Branch: MULTI-ANGLE SINGLE VIEW (is_multi_angle=true)
This anchor is ONE specific view of the same subject; sibling anchor_ids carry the other views. Render THIS anchor's target view as its own solitary image (mirrors story-mode's per-angle single-view generation, where each angle is a separate distinct image).
- Determine THIS anchor's target view from its label / keyword / anchor_id suffix, e.g. "_front" -> "a front portrait view", "_profile" / "_side" -> "a side profile view", "_left_profile" -> "a left profile view", "_back" / "_full_body_back" -> "a full body back view", "_full_body_front" -> "a full body front view". If no view is encoded, infer the single most likely view from the label.
- Use the attached source image ONLY for identity consistency (face, hair, ${isCharacter ? 'wardrobe' : 'packaging text / brand / color scheme / logos'}, colors). Do NOT copy or reproduce the source image's framing, and NEVER reproduce a turnaround / model sheet / multi-panel layout: render the single target view fresh so each sibling angle is a DIFFERENT image.
- Header template: "A single reference image of ${isCharacter ? '<proper_name or visual_tag>' : '<visual_tag>'}, <key identifying traits from visual_reference>${isCharacter ? ', wearing <exact wardrobe / hair from visual_reference>' : ', preserving exact packaging text (verbatim) / brand name / color scheme / logos from <visual_reference>'}.${styleSuffix}"
- shot_list: EXACTLY ONE entry -- the target view phrase for this anchor (e.g. "a front portrait view", "a left profile view", "a full body back view").
- Assemble the generation_prompt as: <header> + " " + <the single shot_list view phrase> + "." + " " + <layout block VERBATIM>. Do NOT use the "containing views of:" grid phrasing and do NOT append any grid technical block.
- Layout block (append VERBATIM at the END of generation_prompt):
  "${SINGLE_VIEW_LAYOUT_BLOCK} ${anchorSubjectCleanliness(isCharacter)} ${ANCHOR_NO_MARKS}"`
  }

  if (params.branch === 'singer_single_view') {
    const styleSuffix = params.styleText.trim() ? ` ${params.styleText.trim()}.` : ''
    return `Branch: SINGER SINGLE VIEW (anchor_id=char_singer)
This anchor is the canonical music-video singer / rapper / solo vocal performer. Render one clean reusable character reference image, not a turnaround sheet or multi-panel grid, so downstream lip-sync keyframes do not inherit a grid composition.
- Header template: "A single reference image of <proper_name or visual_tag>, <key identifying traits from visual_reference>, wearing <exact clothing/hair from visual_reference>.${styleSuffix}"
- shot_list: EXACTLY ONE entry -- "a front 3/4 full-body singer reference view".
- Assemble the generation_prompt as: <header> + " " + <the single shot_list view phrase> + "." + " " + <layout block VERBATIM>. Do NOT use the "containing views of:" grid phrasing and do NOT append any grid technical block.
- Layout block (append VERBATIM at the END of generation_prompt):
  "${SINGLE_VIEW_LAYOUT_BLOCK} ${anchorSubjectCleanliness(isCharacter)} ${ANCHOR_NO_MARKS}"
- Final aspect: 2:3.`
  }

  if (params.branch === 'styled') {
    const views = isCharacter ? CHARACTER_STYLED_SHOTS : PROP_STYLED_SHOTS
    const shotListLiteral = views.map((view) => `"${view}"`).join(', ')
    return `Branch: STYLED 2x2 GRID (is_multi_angle=false, styleText present)
Style text: "${params.styleText.trim()}"
- Header template: "A ${isCharacter ? 'character' : 'prop'} reference sheet of <visual_tag>, <key identifying traits from visual_reference>${isCharacter ? ', wearing <exact clothing/hair from visual_reference>' : ', preserving exact packaging text (verbatim) / brand name / color scheme / shape / logos from <visual_reference>'}. ${params.styleText.trim()}."
- Adapt description complexity to the style -- e.g. a stick-figure style should NOT describe detailed facial features or realistic wardrobe textures. Focus on the essential identifying traits (silhouette, key props, color) that matter for the style.
- shot_list (exactly 4 lowercase entries, preserving order): ${shotListLiteral}
- shot_list must be rendered into the generation_prompt as "containing views of: <comma-separated entries>."
- Layout block (append VERBATIM at the END of generation_prompt):
  "${STYLED_LAYOUT_BLOCK} ${anchorViewConsistency(isCharacter)} ${ANCHOR_NEUTRAL_PRESENTATION} ${anchorSubjectCleanliness(isCharacter)} ${ANCHOR_NO_MARKS} --ar 1:1"
- Final aspect: 1:1.`
  }

  const views = isCharacter ? CHARACTER_PHOTOREAL_SHOTS : PROP_PHOTOREAL_SHOTS
  const shotListLiteral = views.map((view) => `"${view}"`).join(', ')
  return `Branch: PHOTOREAL 2x3 GRID (is_multi_angle=false, no styleText)
Photoreal "ground truth" reference sheet. IGNORE any artistic style in the world_bible here -- this asset is a structural reference, upgraded to studio quality.
- Header template (CHARACTER): "A studio reference grid of <visual_tag>, <age/body from visual_reference>, wearing <exact wardrobe & accessories from visual_reference>. <exact face/hair details from visual_reference>. Neutral grey background, studio lighting."
- Header template (PROP): "A studio reference grid of <visual_tag>, <visual_reference>, preserving exact packaging text (verbatim) / brand name / color scheme / shape / material / logos from the source image. Isolated on neutral grey background, studio lighting."
- shot_list (exactly 6 lowercase entries, preserving order): ${shotListLiteral}
- shot_list must be rendered into the generation_prompt as "containing views of: <comma-separated entries>."
- Layout block (append VERBATIM at the END of generation_prompt):
  "${PHOTOREAL_LAYOUT_BLOCK} ${anchorViewConsistency(isCharacter)} ${anchorSubjectCleanliness(isCharacter)} ${ANCHOR_NO_MARKS} --ar 2:3"
- Final aspect: 2:3.`
}

// Empty string when the project carries no usable facts, so anchors on a
// brief without a brand bank keep byte-identical prompts (mirrors
// renderBrandReferencesSection / renderCastConstraintsSection).
function renderBusinessContextSection(context: AnchorBusinessContext | null | undefined): string {
  if (!context) {
    return ''
  }
  const lines = [
    context.businessName ? `- Business: ${context.businessName}` : null,
    context.aboutUs ? `- About: ${context.aboutUs}` : null,
    context.targetAudience ? `- Audience: ${context.targetAudience}` : null,
    context.topic ? `- Video topic: ${context.topic}` : null,
    context.keyEntities && context.keyEntities.length > 0
      ? `- Key entities: ${context.keyEntities.join(', ')}`
      : null,
  ].filter((line): line is string => line !== null)
  if (lines.length === 0) {
    return ''
  }
  return `

Business Context (the project this anchor belongs to -- use it to keep an invented surface on-topic, and as the ONLY source for legible copy):
${lines.join('\n')}`
}

/**
 * The anchor's subject name, falling through all four carriers. The manager
 * schema declares `label` as .min(1), so a name is effectively always
 * available; the all-empty case is reachable via `normalizeAnchorRequest`,
 * which defaults `proper_name` to null and `visual_tag` to ''.
 *
 * Shared by the Subject Scoping line and the style-text `[SUBJECT]`
 * substitution so the two cannot name the subject differently.
 */
function resolveAnchorSubjectName(anchor: AnchorAssetCandidate): string {
  return (
    anchor.proper_name?.trim() ||
    anchor.visual_tag?.trim() ||
    anchor.keyword?.trim() ||
    anchor.label?.trim() ||
    ''
  )
}

/**
 * The preset style catalog's style texts (presets/story-mode/styles.json) are
 * authored with a literal `[SUBJECT]` placeholder ("A high-end 3D render of
 * [SUBJECT] in the style of..."), in many of its presets. Nothing substituted
 * it, so the image model was handed the literal brackets -- observed on a run
 * where three of four anchors kept `[SUBJECT]` while a fourth
 * happened to get it replaced by the prompt-spec LLM.
 *
 * Substituting in code rather than instructing the LLM: this is a deterministic
 * string operation, and routing it through the author makes it a request rather
 * than a guarantee. Falls back to "the subject", which stays grammatical in the
 * catalog's phrasing, when the anchor carries no name at all.
 */
function substituteStyleSubject(styleText: string, anchor: AnchorAssetCandidate): string {
  if (!styleText.includes('[SUBJECT]')) {
    return styleText
  }
  return styleText.split('[SUBJECT]').join(resolveAnchorSubjectName(anchor) || 'the subject')
}

/**
 * The anchor manager deliberately shares ONE upload across several anchors when
 * a frame holds several subjects ("every distinct subject in it MUST get its
 * own anchor, and that image becomes a shared source for each"). The User Asset
 * Protocol below then tells each of them to preserve ALL observable detail from
 * that image -- which on a two-person frame is actively wrong. Naming this
 * anchor's own subject scopes the rule.
 *
 * Emitted unconditionally: the builder sees one anchor at a time and cannot
 * know whether a sibling shares its source, and on a single-subject image the
 * line is a no-op. Prefer proper_name -- visual_tag is a functional descriptor
 * that can match either person in a shared frame.
 */
function renderSubjectScopingLine(anchor: AnchorAssetCandidate): string {
  const subject = resolveAnchorSubjectName(anchor)
  if (!subject) {
    return ''
  }
  // An OBJECT's own packaging, contents, and parts ARE the subject -- only
  // hands, people, and unrelated clutter are excluded. "Every other object"
  // would strip a product of its own box.
  const others =
    anchor.type === 'CHARACTER'
      ? 'ignore every other person, animal, or object sharing the frame'
      : 'ignore every person and hand, and every unrelated object sharing the frame, while keeping any packaging, contents, and parts that belong to this product'
  return `
- Subject Scoping (applies to every rule in this section): This anchor's subject is "${subject}". Read appearance ONLY from that subject; ${others}, and ignore the source's background, room, location, furniture, and scene entirely. "ALL observable appearance details" above means all of THAT subject's details -- never merge traits from a co-subject, and never carry a co-subject or a background element into the output.`
}
