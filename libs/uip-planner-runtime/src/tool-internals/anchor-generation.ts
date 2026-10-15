import type { Content } from '@reelmakeeasy/common/llm'
import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'

import { PLANNER_TOOL_MODELS } from '../model-config'
import type { createPlannerStorage } from '../persistence'
import { loadPlannerJsonArtifact, persistPlannerJsonArtifact } from '../persistence'
import type {
  AnchorAssetCandidate,
  AnchorAssetPromptSpec,
  AnchorAssetPromptSpecsArtifact,
  AnchorAssetsSummary,
  AnchorAssetSummaryItem,
  AssetDescriptionsArtifact,
  BrandBank,
  PlannerToolParams,
  UploadedAsset,
} from '../types'

import type { AnchorGender } from './anchor-gender'
import {
  buildAnchorGenderCorrection,
  isAnchorGenderMismatch,
  resolveAnchorGender,
} from './anchor-gender'
import type { AnchorImageResult } from './anchor-image-gen'
import { UIP_ANCHOR_FINAL_DIR } from './anchor-image-gen'
import {
  type BrandStagedAssetMetaEntry,
  classifyKeepRawAssetIds,
} from './anchor-keep-raw-classifier'
import type { DescriptionsById, UploadedById } from './anchor-plan'
import { normalizeAnchorId, normalizeAnchorOperation, normalizeSourceAssetIds } from './anchor-plan'
import type { AnchorBusinessContext, AssetDescriptionItem } from './anchor-prompt-spec-builder'
import { buildAnchorPromptSpecPrompt } from './anchor-prompt-spec-builder'
import {
  isMultimodalImageMimeType,
  mapWithConcurrency,
  uploadedAssetToContent,
} from './anchor-utils'
import type { ArticleContext } from './article-prompt-facts'
import { articleImageAnchorRefs } from './article-prompt-facts'
import { synthesizeBrandAssetId } from './brand-staged-assets-to-uploads'

const UIP_ANCHOR_ASSETS_DIR = 'anchor_assets'
export const UIP_ANCHOR_PROMPT_SPECS_PATH = `${UIP_ANCHOR_ASSETS_DIR}/prompt_specs.json`
export const UIP_ANCHOR_GENERATION_PROMPTS_PATH = `${UIP_ANCHOR_ASSETS_DIR}/generation_prompts.json`
export const UIP_ANCHOR_FINAL_INDEX_PATH = `${UIP_ANCHOR_FINAL_DIR}/index.json`
// Phase B prompt-spec is on-demand PLANNER_TOOL_MODELS text -- NOT PT-gated
// like Phase C's image model -- so concurrency is a real lever here, not a
// wall. avg anchors/plan ~3 (already one wave, so the median is unmoved); 6
// collapses the N>3 multi-anchor tail (4-8 anchor bootstrap_visual plans) from
// two waves to one. Phase C stays at 3 (UIP_ANCHOR_IMAGE_CONCURRENCY): raising
// it only deepens the shared PT queue.
const UIP_ANCHOR_PROMPT_SPEC_CONCURRENCY = 6

const logger = createSubLogger('user-intent-planner')

import { AnchorPromptSpecOutputSchemaLegacy } from './anchor-response-schemas'

export {
  AnchorAssetManagerOutputSchema,
  AnchorAssetManagerOutputSchemaLegacy,
  AnchorPromptSpecOutputSchema,
  AnchorPromptSpecOutputSchemaLegacy,
} from './anchor-response-schemas'

const ANCHOR_ASSET_MANAGER_PROMPT = `Role: Production Logistician, Breakdown Artist, and Anchor Asset Manager.

Objective:
Combine the jobs of story-mode asset_manifest + asset_manager for UIP.
Identify the full set of recurring anchor concepts (Characters and Objects/Props) that matter for visual continuity, and bind each one to the best user-provided reference image when one exists.

The Breakdown Protocol

Step 1: The Rule of Recurrence (Qualification)
- Scan the working script, pinned user prompt, uploaded asset descriptions, uploaded asset catalog, and world_bible.
- Only qualify recurring Characters and recurring Objects/Props that materially recur across the story -- the viewer must recognize them as the same entity across multiple shots. Weigh narrative importance over raw mention count.
- Exception to recurrence: user-uploaded subjects and NAMED on-screen characters ALWAYS qualify even if they appear only once. The recurrence test gates only non-uploaded, unnamed candidates; it never overrides User Asset Completeness or Step 6.
- Ignore Sets, Locations, environments, atmospheric motifs, and one-off background items.
- Do not invent unrelated assets from the world_bible. Use world_bible only as a continuity lens for deciding what is anchor-worthy.

User Asset Completeness (reason about SUBJECTS, not files):
- Enumerate every DISTINCT subject (character / product / object) depicted across ALL uploaded images, then guarantee each distinct subject is covered by exactly ONE anchor -- the SOLE exception is Step 4 multi-angle views from MULTIPLE SEPARATE single-view uploads of one entity (distinct angle files), which split into one anchor PER VIEW (is_multi_angle: true). A single uploaded multi-view SHEET does NOT split -- it stays ONE anchor (see Step 4). Two facts hold independently and BOTH must be honored:
  - One subject may span multiple uploads -- list them all in source_asset_ids under a SINGLE anchor; never create duplicate anchors for the same subject.
  - One upload may depict MULTIPLE subjects (e.g. two characters in one frame) -- every distinct subject in it MUST get its own anchor, and that image becomes a shared source for each. NEVER let a co-appearing subject be absorbed into another subject's anchor and silently dropped.
- Include every uploaded subject even when it recurs only once. Skip an upload only when it is a purely stylistic reference (color palette, vibe board) with no physical subject in the narrative.
- A user-uploaded product / app-UI screenshot that demonstrates how the product works SHOULD be anchored (it renders raw, not restyled). Do not skip it as "not a product/object" -- the on-screen UI is the subject.

Do NOT include (text-only mentions; eligible only when the user uploaded an exact image of it):
- Logos, brand marks, screenshots, UI screens, software tools, APIs, dashboards, websites, apps, workflow nodes, brand names, or platform names. These are graphic / brand assets -- never invent one from a text-only mention.
- Abstract concepts, services, offers, features, benefits, statistics, data flows, charts, diagrams, labels, text callouts, example domains, environments, or one-off props.
- A narrator or voice-over speaker UNLESS the script explicitly describes them appearing on screen (e.g. "I walk into the room", "the host picks up the product"). A disembodied narrator providing commentary does NOT need a visual character anchor.

DO anchor (even with no uploaded image):
- A recurring, narratively-central PHYSICAL product or object that the video repeatedly centers on -- e.g. the hero product in a product ad, the vehicle in a car ad, a signature item shown across multiple shots. Qualify it under Step 1 and generate it from the script + world_bible (source_asset_id=null) so it stays visually consistent across shots. This is distinct from the brand logos / marks / screenshots above (still excluded) and from one-off background objects (still excluded).

Named-Group Expansion:
- If the world_bible's key_entities or the script names a group with an explicit member roster -- pattern "<GroupName> (<Member1>, <Member2>, ...)", e.g. "The Comets (Ava, Bea, Cleo)" -- you MUST create ONE separate character anchor PER named member, each with a distinct anchor_id and proper_name set to that member's name. This applies even when the prose refers to the rest collectively ("the girls", "the trio").

Groups and Crowds:
- Do NOT create group character anchors. When the script mentions a crowd or category of people (e.g. "travelers", "protesters"), pick ONE representative individual and create a single-person character anchor for them (anchor images depict a single subject).

Step 2: Source Selection
- When a matching uploaded image exists for an anchor, set source_asset_id to the single most canonical image and list the full supporting set in source_asset_ids; source_asset_id MUST equal source_asset_ids[0]. When no matching uploaded image exists, set source_asset_id to null and source_asset_ids to [].
- Choose the primary image using this priority:
  - highest identity recognizability
  - highest information completeness
  - clearest / least obstructed view
  - most canonical hero-reference angle
- Use source_asset_ids[1..] only for complementary angles or details.
- Do not include near-duplicate or low-value images in source_asset_ids.

Step 3: Visual Metadata Extraction (for each anchor)
Emit the following metadata fields per anchor. These drive downstream prompt spec and visual-script subject substitution.

Role semantics are exhaustive:
- When the user defines a character by a relational, gendered, occupational, or spatial role, preserve that meaning in the character's label and subject_gender instead of reducing the subject to a generic person or host.
- When two or more characters form a complementary set, apply the complete mapping to every member. Never enrich only one side of a complementary pair and leave its counterpart generic.
- Retain both semantic and spatial aliases when both are needed for continuity. Example: emit label "Wife / Host Left" with subject_gender "female" AND label "Husband / Host Right" with subject_gender "male"; do not collapse them to "Host Left", "Host Right", or "a husband and wife".
- Before emitting, reconcile every explicit role in the pinned prompt, latest user message, script, and constraints against exactly one character anchor. A role assigned to one anchor must not migrate to a sibling anchor sharing the same source image.

- visual_tag: a concise 3-word functional identifier using Title Case.
  Good: "Male Athletic Runner", "Aluminum Relay Baton", "Elder Female Scientist".
  Bad: "The Runner", "A glowing cyberpunk hero", "Main Character".

- visual_reference: describe Demographics and Physiology ONLY. Do NOT describe style, lighting, mood, atmosphere, or rendering medium.
  Good: "Adult male, 20s, sprinter's build, short dark hair", "A standard aluminum relay baton, 30cm length".
  Bad: "A glowing cyberpunk hero made of neon data", "Warm-lit romantic portrait of a woman".
  Do NOT invent visual details, colors, or materials unless explicitly stated in the script, user prompt, or user assets. When a detail is absent, keep visual_reference minimal and generic rather than fabricating specifics.

- keyword: a short "The <X>" style label for logging and UI display.
  Good: "The Runner", "The Baton", "The Scientist".

- proper_name: the specific named person / brand / product if the script or user prompt named one; otherwise null.
  Good: "Elon Musk", "Nike Dri-FIT", null.
  Do not invent proper names. Use null when the entity is generic.

- subject_gender: one of "male", "female", "unknown". For a CHARACTER anchor, this is the SAME gender you just described in visual_reference, restated as a structured value -- downstream steps compare against this field instead of re-reading your prose, so the two MUST agree. Use "unknown" only when the script and user prompt genuinely do not establish a gender; do not guess one. Always "unknown" for an OBJECT anchor.
  Good: visual_reference "Adult male, 20s, sprinter's build" -> subject_gender "male".

- prompt_transform: the form the user's prompt asks THIS anchor's subject to take, quoted from the pinned user prompt, e.g. "a pirate". Set null when the anchor is the subject's as-uploaded / as-scripted appearance -- which is the normal case.
  Good: prompt "Sam becomes a pirate" -> the Sam anchor's prompt_transform "a pirate".
  Good: no transformation requested -> null.
  Bad: "pirate-style", "make him cool", "cinematic" -- a rendering style or a vague mood is NOT a transform; those belong to the project's style layer.

Step 3b: Prompt Transform Attribution
- Read per-subject transforms out of the Pinned User Prompt. The Working Script is narration (what the audience HEARS) and carries no transformation intent -- do not go looking for one there.
- A transformation the prompt assigns to a NAMED subject ("Sam becomes a pirate, Momo becomes an astronaut") belongs to THAT subject's anchor and to no other. Never apply one subject's transform to another, and never apply a transform globally when the prompt named a specific subject.
- The transformed subject keeps its uploaded reference: still bind the subject's image via source_asset_id, because that image carries the identity (face, build) that must survive the costume. Setting prompt_transform does NOT mean "no source".
- prompt_transform does not change the anchor set. One subject still gets exactly ONE anchor; you are annotating that anchor with the form the prompt asked for, not adding a second anchor for the original form.
- A named-group member with its own transform carries it on that member's anchor only, never on the group's other members.

Step 4: Multi-Angle Detection
- Split into per-view anchors (is_multi_angle: true) ONLY when the multiple views of the exact same entity arrive as MULTIPLE SEPARATE uploaded images -- distinct single-view files (e.g. front.png, side.png, back.png). Emit one anchor entry PER view.
- Use a suffixed anchor_id that names the view: "char_hero_front", "char_hero_profile", "char_hero_back", "char_hero_full_body_back", "prop_bottle_front", "prop_bottle_side".
- SINGLE-IMAGE multi-view sheet -- do NOT split. When ONE uploaded image is itself a turnaround / character model sheet / contact sheet that lays out several views in one frame, emit ONE anchor for the entity with is_multi_angle: false. It is ALREADY a complete multi-view reference, so downstream renders a single styled multi-view grid from it (using the sheet for identity). Do NOT split a ready-made sheet into per-view anchors -- regenerating N single views is wasteful and drifts from the user's own reference.
- is_multi_angle: true signals downstream to render THAT specific single view as its own solitary image (not a multi-view grid). Per-view sibling anchors come from separate uploads, so each carries its own source_asset_id and each renders a different view.
- If the entity has only a single view and there is no multi-view intent, is_multi_angle: false (the downstream grid renders multiple synthetic views from that one reference).
- If multiple images are different entities (not different angles of the same entity), is_multi_angle: false.

Step 5: Passthrough Detection
- passthrough: true means the uploaded source image is already a finished reference and should be used directly as the anchor image WITHOUT going through generative image regeneration.
- Set passthrough: true only when ALL of the following hold:
  - Exactly one source image is attached to this anchor.
  - The image is a pure graphic mark: brand logo, icon, flat app UI element, or vector-style mark.
  - Background is either transparent, single flat color, or clean studio isolation.
  - No people, real-world materials, textures, or scene elements appear.
  - Regenerating it would risk altering brand fidelity (distorted letters, changed colors, lost crispness).
- For anything featuring a real subject (person, product in environment, textured object, photographic content), passthrough: false.
- Passthrough and prompt_transform are contradictory: passthrough copies the source image through untouched, so no transform can be applied to it. When both would apply to one anchor, passthrough wins and you MUST set prompt_transform to null. Logos, app UI, and infographics carry their value in informational fidelity, and preserving that outranks a costume request.

Step 6: Coverage Reconciliation (perform before emitting -- the anchor set must be COMPLETE)
- Distinct-subject coverage: re-scan the uploaded images and confirm every distinct depicted subject you identified is represented by exactly one anchor (multi-subject frames included; Step 4 multi-angle per-view siblings are the sole exception -- one entity may legitimately hold several is_multi_angle anchors). Do NOT drop a subject just because another subject sharing its frame is already anchored.
- Transform coverage: for every subject the pinned user prompt assigned a transformation to, confirm that subject's anchor carries it in prompt_transform. Silently emitting the untransformed form is the most common failure of this rule.
- Named-character coverage: cross-reference world_bible.key_entities AND the working script. Every NAMED character that visually appears -- it has an uploaded image, OR the script describes it appearing on screen -- MUST have an anchor (bind its uploaded image via source_asset_id when one exists, else source_asset_id=null). This holds regardless of screen time -- a supporting named character still gets one.
- key_entities is an UNTYPED hint list that may contain non-characters (episode / series titles, concepts, themes, locations -- e.g. an entry that is the story's title, not a person). Do NOT anchor those; keep applying the Step 1 exclusions and the "Groups and Crowds" rule (generic crowds still collapse to one representative). Coverage applies to named, on-screen characters and recurring physical objects only.

Output Rules
- type must be CHARACTER or OBJECT.
- anchor_id must be a stable snake_case identifier.
- label must be short and human-readable.
- reason must explain continuity value, not aesthetic preference.
- NEVER copy "[file_id: ...]", "[filename: ...]", or "[asset_id: ...]" label text into any output field (label, keyword, visual_tag, visual_reference, proper_name). These bracketed labels are internal reference only.
- Output JSON only.
- Use ONLY ASCII double quotes (Unicode code point U+0022). Do NOT use any other Unicode quotation marks -- specifically not U+201C (left double quotation mark), U+201D (right double quotation mark), U+2018 (left single quotation mark), or U+2019 (right single quotation mark). Non-ASCII quotes break JSON parsing and silently drop all anchors after the first one.
- Each anchor object must close its own braces before the next one begins. Never embed a JSON object literal inside a string field.
- visual_tag is a 3-word Title Case identifier and MUST be at most 50 characters. Exceeding this cap indicates a structural error -- restart the current anchor object.

Output schema:
{
  "anchors": [
    {
      "anchor_id": "stable_snake_case_id",
      "label": "Human readable label",
      "type": "CHARACTER | OBJECT",
      "reason": "Why this anchor matters for continuity",
      "source_asset_id": "asset_xxx | null",
      "source_asset_ids": ["asset_xxx", "asset_yyy"],
      "visual_tag": "3-word Title Case identifier",
      "visual_reference": "Demographics/physiology description, no style",
      "keyword": "The <X>",
      "proper_name": "Named Person or Brand | null",
      "subject_gender": "male | female | unknown",
      "prompt_transform": "a pirate | null",
      "is_multi_angle": false,
      "passthrough": false
    }
  ]
}`

export function buildAnchorAssetManagerPrompt(params: {
  /**
   * Optional article context. When the
   * story's key image was extracted, an ARTICLE IMAGE REFERENCE block tells
   * the anchor planner to bind the story/hero shot to the real photo and set
   * passthrough=true, so it renders VERBATIM instead of being regenerated in
   * the video style (mirrors the brand-logo passthrough rule). Null / no key
   * image -> byte-identical to non-news sessions.
   */
  articleContext?: ArticleContext | null
  assetDescriptions: AssetDescriptionsArtifact
  /**
   * Optional Tier 1 brand bank. When present, a BRAND CONCEPT REFERENCES
   * block annotates which asset_ids in Uploaded Assets JSON are brand-
   * supplied so the anchor-asset manager can prefer them as anchor
   * sources for shots that depict the brand. The asset bytes themselves
   * are already in `Attached Uploaded Images` (merged in by the caller
   * via `brandStagedAssetsToUploads`); this block is a textual annotator
   * only. Null on non-brand sessions; the prompt is byte-identical to
   * the non-brand prompt in that case.
   */
  brandBank?: BrandBank | null
  /**
   * `global_constraints.directives` -- positive "do this" rails from the
   * brief. Surfaced so the asset manager can honor cast-shaping ones (e.g.
   * an all-male cast) when it decides who exists and each character's
   * `subject_gender`. Empty on briefs without directives.
   */
  directives?: string[]
  latestUserMessage: string
  /**
   * `global_constraints.must_not_violate` -- hard prohibitions. Read by the
   * visual-script prompt but historically NOT by the anchor pipeline, so a
   * "no women / all characters male" rule never reached the step that sets
   * `subject_gender` and a female character was generated anyway.
   * Empty on briefs without prohibitions.
   */
  mustNotViolate?: string[]
  pinnedRawUserPrompt: string
  script: string
  uploadedAssets: UploadedAsset[]
  /**
   * Optional voice character description for soft-biasing narrator
   * anchor visual characteristics. Source: audio-mode LLM analysis of
   * uploaded voiceover, OR rendered from `SessionState.voiceProfile`
   * (preset / clone). When undefined, no voice section is injected.
   */
  voiceCharacterText?: string
  worldBible: unknown
}): string {
  const assetDescriptionsJson = JSON.stringify(params.assetDescriptions, null, 2)
  const uploadedAssetsJson = JSON.stringify(
    params.uploadedAssets.map((asset) => ({
      asset_id: asset.asset_id,
      content_type: asset.content_type,
      file_name: asset.file_name,
    })),
    null,
    2,
  )

  // Voice character soft-injection. Mirrors story-mode's
  // `voiceCharacterSection` with UIP anchor terminology so anchor
  // decisions in UIP and story-mode stay aligned.
  const voiceCharacterSection = params.voiceCharacterText
    ? `Voice Character Analysis: ${params.voiceCharacterText}
Only create a character anchor for this voice if the script describes the speaker appearing visually on screen. If the voice is purely narration/commentary with no on-screen presence, they do NOT need a visual character anchor. When you DO create a narrator character anchor, give it anchor_id "char_narrator" and keyword "The Narrator"; the visual_reference (gender, age range, build, demeanor) and subject_gender must be consistent with this voice description.
For music-video, singing, rapping, or lip-syncable solo performance shots, decide whether an on-screen singer, rapper, or solo performer is appropriate from the user brief, uploaded assets, visual intent, and music-video concept. When appropriate, create one canonical singer anchor with anchor_id "char_singer" and keyword "The Singer"; this is the character intended to carry sung/rap performance and lip sync. Do not create char_singer merely because the route is music, especially when the user asks for scenery, abstract visuals, product/object-centric visuals, lyric-only visuals, or no visible people. If a user-uploaded character/person image is a suitable singer/artist/performer reference, bind char_singer to that source asset; otherwise, when a generated singer is appropriate, generate char_singer from the Voice Character Analysis. The char_singer gender presentation and age cues MUST match the Voice Character Analysis. Do not let char_singer replace the narrative cast: still create separate CHARACTER anchors for recurring on-screen story actors, named people, dancers, love interests, rivals, or other visually recognizable performers that need continuity. Other characters may act in the story, but they are actors, not the singer, and they still need their own anchors when they qualify under Step 1's recurrence rules.

`
    : ''

  const brandReferencesSection = renderBrandReferencesSection(params.brandBank ?? null)
  const articleReferencesSection = renderArticleReferencesSection(params.articleContext ?? null)
  const castConstraintsSection = renderCastConstraintsSection(
    params.mustNotViolate ?? [],
    params.directives ?? [],
  )

  return `${ANCHOR_ASSET_MANAGER_PROMPT}

${castConstraintsSection}${voiceCharacterSection}Pinned User Prompt:
${params.pinnedRawUserPrompt}

Latest User Message:
${params.latestUserMessage}

Working Script:
${params.script}

World Bible JSON:
${JSON.stringify(params.worldBible, null, 2)}

Uploaded Assets JSON:
${uploadedAssetsJson}

Asset Descriptions JSON:
${assetDescriptionsJson}

${brandReferencesSection}${articleReferencesSection}Attached Uploaded Images:
The uploaded image contents are attached in the exact same order as Uploaded Assets JSON. Match each image to its asset_id using that ordered list.
`
}

export function buildAnchorAssetsSummary(params: {
  candidates: AnchorAssetCandidate[]
  existingSummary: AnchorAssetsSummary | null
  generationResults: AnchorImageResult[]
  // anchor_ids rehydrated from the brand library this run. Also OR-ed
  // with the prior summary's `reused` so a persisted-plan reload keeps the flag.
  reusedAnchorIds?: readonly string[]
}): AnchorAssetsSummary {
  const generationResultsById = new Map(
    params.generationResults.map((item) => [item.anchor_id, item] as const),
  )
  const existingById = new Map(
    (params.existingSummary?.anchors ?? []).map((item) => [item.anchor_id, item] as const),
  )
  const reusedAnchorIds = new Set(params.reusedAnchorIds ?? [])
  const anchors = params.candidates.map((candidate) => {
    const generationResult = generationResultsById.get(candidate.anchor_id)
    const existing = existingById.get(candidate.anchor_id)
    const status = generationResult?.status === 'success' ? 'ready' : (existing?.status ?? 'failed')

    return {
      anchor_id: candidate.anchor_id,
      is_multi_angle: candidate.is_multi_angle,
      keyword: candidate.keyword,
      label: candidate.label,
      passthrough: candidate.passthrough,
      preview_asset_id: generationResult?.preview_asset_id ?? existing?.preview_asset_id ?? null,
      preview_relative_path:
        generationResult?.preview_relative_path ?? existing?.preview_relative_path ?? null,
      // The summary is a hand-written projection, separate from the
      // plan. The anchor library's manifest writer and `plan-asset-assignment`
      // both read the summary, so a transformed anchor is invisible to them
      // unless the field is carried across here.
      prompt_transform: candidate.prompt_transform ?? null,
      proper_name: candidate.proper_name,
      // Reused iff bound from the library this run, OR it was reused before and
      // was NOT regenerated this turn. An ANCHOR_IDS edit produces a fresh
      // generationResult for the anchor and never re-binds, so editing a reused
      // anchor clears the badge (the image is now freshly generated).
      reused:
        reusedAnchorIds.has(candidate.anchor_id) ||
        (existing?.reused === true && !generationResultsById.has(candidate.anchor_id)),
      source_asset_id: candidate.source_asset_id,
      source_asset_ids: candidate.source_asset_ids ?? [],
      status,
      type: candidate.type,
      visual_tag: candidate.visual_tag,
    } satisfies AnchorAssetsSummary['anchors'][number]
  })

  const readyCount = anchors.filter((item) => item.status === 'ready').length
  const totalCount = anchors.length

  return {
    anchors,
    generated_at: new Date().toISOString(),
    ready_count: readyCount,
    status:
      totalCount === 0
        ? 'success'
        : readyCount === totalCount
          ? 'success'
          : readyCount > 0
            ? 'partial'
            : anchors.some((anchor) => anchor.status === 'planned')
              ? 'partial'
              : 'failed',
    total_count: totalCount,
  }
}

function renderArticleReferencesSection(article: ArticleContext | null): string {
  const refs = articleImageAnchorRefs(article)
  if (refs.length === 0) {
    return ''
  }
  const source = article?.site_name || article?.url || 'the article'
  const heroId = refs[0]?.assetId ?? ''
  const refList = refs.map((r) => `- ${r.label}: ${r.assetId}`).join('\n')
  return `ARTICLE IMAGE REFERENCES (news-article-to-video door -- ${source}): the asset_ids below are the REAL photographs the source article ran with. They are already in Uploaded Assets JSON with bytes attached and are the authoritative visuals of the story.

Binding rules (these OVERRIDE both Step 1 anchor qualification AND Step 2 Source Selection for these assets; mirror the brand-logo passthrough rule in Step 5):
- ALWAYS create a dedicated hero anchor for the FIRST ref (${heroId}), even when the script has no recurring character or object that would otherwise qualify one under Step 1 (e.g. a breaking-news event or a place). Emit it with anchor_id "prop_article_hero", type Prop, keyword "The Story", source_asset_id ${heroId}, and passthrough=true, bound to the opening / establishing shot. This asset MUST appear as an anchor in your output.
- DISTRIBUTE the remaining article photos across the video: for each additional shot whose subject is a part of the story the article depicts (an event, place, or person), bind that shot to the most fitting article photo below as source_asset_id with passthrough=true instead of generating a substitute. Each additional photo used MUST back its own anchor whose anchor_id starts with "prop_article_" (e.g. "prop_article_photo_2"), type Prop, passthrough=true -- downstream photo handling keys on that id prefix. Prefer using more of these real photos over inventing generated visuals.
- passthrough=true means the real photo is used VERBATIM instead of being regenerated in the video style. Do NOT return no candidate for a shot the article's own photos can serve.

Available article refs (hero first, then in-body photos in article order):
${refList}

`
}

function renderBrandReferencesSection(brandBank: BrandBank | null): string {
  if (!brandBank) {
    return ''
  }
  const businessName = brandBank.basic_info.business_name
  const buckets: Array<['character' | 'logo' | 'product', typeof brandBank.staged_assets.logo]> = [
    ['logo', brandBank.staged_assets.logo],
    ['product', brandBank.staged_assets.product],
    ['character', brandBank.staged_assets.character],
  ]
  const renderedBuckets = buckets
    .map(([name, refs]) => {
      if (refs.length === 0) {
        return null
      }
      const ids = refs.map((ref) => synthesizeBrandAssetId(ref.staging_uri, name)).join(', ')
      return `- ${name}: ${ids}`
    })
    .filter((line): line is string => line !== null)
  if (renderedBuckets.length === 0) {
    return ''
  }
  return `BRAND CONCEPT REFERENCES (HIGH-INTENT USER SIGNAL -- ${businessName}): the asset_ids below are already in Uploaded Assets JSON with bytes attached. These refs were extracted from the user's site AND explicitly kept by the user through brand review (they saw the full candidate list and chose to keep these; everything else was removed). Treat their presence as a strong, explicit "use these" signal -- the user is telling you what their brand looks like.

Binding rules (override the Step 2 Source Selection priority when applicable; a brand logo additionally sets passthrough=true per Step 5):
- A brand logo MUST be used as source_asset_id for any anchor whose visual_tag includes "Logo" / "Mark" / "Brand", any anchor where proper_name equals "${businessName}" or is a recognizable variant of it (case-insensitive, punctuation-insensitive, common abbreviation -- e.g. "Acme Co." / "Acme" / "acme" / "ACME, Inc." all match "${businessName}"), or any anchor whose role is to depict the brand identity. Point source_asset_id at the brand logo asset_id and set passthrough=true.
- A brand product image SHOULD be used as source_asset_id for any anchor depicting that product or a product in the same category. Point source_asset_id at the brand product asset_id.
- A brand character image SHOULD be used as source_asset_id for any recurring on-screen person anchor where no other character upload is more specific.
- Do not invent a new uncovered anchor for a concept a brand asset already covers. Do not return source_asset_id=null and source_asset_ids=[] for a "brand logo" / "brand product" anchor when an asset_id in this list could plausibly serve.
- When multiple brand logos / products / characters are listed for the same bucket, prefer the FIRST listed asset_id as source_asset_id; the order is already priority-sorted (primary brand mark, in-home-link header logo, hero variants first). Use later asset_ids only as supplementary source_asset_ids[1..].

Available brand refs:
${renderedBuckets.join('\n')}

`
}

// Surfaces the brief's global constraints to the asset manager and, when a
// constraint mandates the cast's gender, makes the asset manager pin every
// character's subject_gender to it. Historically these rails reached the
// visual-script prompt but not the anchor pipeline, so a "no women / all male"
// rule left subject_gender unset and a female character was generated anyway.
// Empty string when the brief has no
// constraints, keeping those prompts byte-identical.
function renderCastConstraintsSection(mustNotViolate: string[], directives: string[]): string {
  const prohibitions = mustNotViolate.map((entry) => entry.trim()).filter(Boolean)
  const dos = directives.map((entry) => entry.trim()).filter(Boolean)
  if (prohibitions.length === 0 && dos.length === 0) {
    return ''
  }
  const bullets = (items: string[]): string => items.map((item) => `- ${item}`).join('\n')
  const prohibitionsBlock =
    prohibitions.length > 0
      ? `MUST NOT VIOLATE (hard prohibitions):\n${bullets(prohibitions)}\n`
      : ''
  const directivesBlock = dos.length > 0 ? `Directives (required):\n${bullets(dos)}\n` : ''
  return `Brief Constraints (global_constraints) -- authoritative rails for who may appear and how each character is depicted:
${prohibitionsBlock}${directivesBlock}
Cast gender rule: when a constraint mandates the on-screen cast's gender -- e.g. "all on-screen characters must be male", "do not depict women", "male-only cast" -- EVERY CHARACTER anchor you create MUST set subject_gender to that mandated gender and write visual_reference to match, overriding any gender the script would otherwise imply. This is a hard compliance rule, not a soft bias. Apply it only when such a cast-gender mandate is actually present; otherwise set subject_gender from each character's own depiction as usual.

`
}

/**
 * Which reference-sheet layout Phase B / Phase C should assemble for
 * this candidate. `passthrough` candidates bypass Phase B entirely
 * (their source image becomes the final anchor), so this function is
 * only called for eligible, non-passthrough candidates.
 *
 * - `multi_angle`: the candidate represents ONE specific view of a
 *   multi-view set -- emit a single hero shot that preserves the source
 *   image's camera angle and aspect.
 * - `singer_single_view`: the canonical music-video singer anchor
 *   (`char_singer`) -- emit one 2:3 single-view character reference so
 *   generated singer shots do not inherit a multi-panel grid.
 * - `styled`: a user style text is present -- emit a 4-view 2x2 grid
 *   reference sheet sized to 1:1.
 * - `photoreal`: no style text -- emit a 6-view 2x3 grid photoreal
 *   "ground truth" reference sheet sized to 2:3.
 */

export async function buildAnchorPromptSpecs(params: {
  /**
   * {asset_id -> {asset_kind, category}} for brand staged assets, used to
   * force logos / brand marks / product UI to raw. Absent on non-brand
   * sessions; direct-upload keep-raw is derived from `descriptionsById`.
   */
  brandStagedAssetMeta?: Map<string, BrandStagedAssetMetaEntry>
  /** See `buildAnchorPromptSpecPrompt.businessContext`. */
  businessContext?: AnchorBusinessContext | null
  candidates: AnchorAssetCandidate[]
  descriptionsById: DescriptionsById
  effectiveStyleText: string
  existingSummary: AnchorAssetsSummary | null
  /** Quality tier for model routing. Absent = compiled-in chain. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  /** Defer canonical prompt artifacts until an atomic rebuild batch commits. */
  persist?: boolean
  /** Full persisted plan, used when `candidates` is only a targeted regeneration subset. */
  planCandidates?: AnchorAssetCandidate[]
  plannerParams: PlannerToolParams
  sessionId: string
  storage: ReturnType<typeof createPlannerStorage>
  uploadedById: UploadedById
  /** See `buildAnchorPromptSpecPrompt.voiceCharacterText`. */
  voiceCharacterText?: string
  /**
   * Structured `perceivedGender` behind `voiceCharacterText`. Authoritative
   * for `char_singer` only -- see `resolveAnchorGender`.
   */
  voiceGender?: AnchorGender
  worldBible: unknown
}): Promise<AnchorAssetPromptSpecsArtifact> {
  const promptSpecSchema = AnchorPromptSpecOutputSchemaLegacy

  const worldBibleJson = JSON.stringify(params.worldBible, null, 2)
  const requestContextByAnchorId = buildAnchorRequestContextByAnchorId(params.plannerParams)
  // Passthrough candidates bypass Phase B entirely: their source image IS the
  // final anchor, so generating a prompt spec (an LLM call with image content
  // and Pro chain) is pure waste. They go straight to Phase C
  // (copyPassthroughSourceToFinal) in anchor-image-gen.ts.
  //
  // The "they go straight to Phase C" half of that contract was broken: Phase
  // C (`generateAnchorImages`) iterates over `promptSpecs.items`, so when we
  // filtered passthroughs out here they were dropped on the floor and never
  // hit `generateSingleAnchorImage` / `copyPassthroughSourceToFinal`. The
  // anchor would then be reported as `failed` in the summary, the user's
  // logo / brand mark would silently never reach the downstream video
  // pipeline, and the only outward signal was the generic
  // "Generated anchor assets with 1 failure(s) (8/9 ready)" string.
  //
  // Fix: split the candidates into the LLM-call set (non-passthrough, runs
  // the prompt-spec mapWithConcurrency below) and the passthrough set
  // (emits synthetic stubs with empty `generation_prompt` / `prompt_spec`
  // and `passthrough: true`). Both lists feed into `items`, so Phase C sees
  // every generation-eligible candidate.
  // Deterministic keep-raw: force passthrough for logos / brand marks / UI /
  // infographics so they are copied verbatim, never style-transferred. Only
  // ever turns passthrough on; the LLM Step-5 verdict stands as a fallback. A
  // candidate with no source image (source_asset_id == null) can never be
  // passthrough, so it is skipped.
  const keepRawAssetIds = classifyKeepRawAssetIds({
    brandAssetMeta: params.brandStagedAssetMeta ?? new Map(),
    descriptionsById: params.descriptionsById,
  })
  // A labelled cast sheet can legitimately classify as a keep-raw infographic,
  // but copying it once per character produces byte-identical anchors. Make the
  // subject-isolation requirement the final authority over both the Plan LLM and
  // deterministic keep-raw classification.
  const characterSourceUsage = new Map<string, number>()
  for (const candidate of params.planCandidates ?? params.candidates) {
    if (candidate.type === 'CHARACTER' && candidate.source_asset_id) {
      characterSourceUsage.set(
        candidate.source_asset_id,
        (characterSourceUsage.get(candidate.source_asset_id) ?? 0) + 1,
      )
    }
  }
  const requiresSubjectIsolation = (candidate: AnchorAssetCandidate): boolean => {
    const sourceId = candidate.source_asset_id
    return (
      candidate.type === 'CHARACTER' &&
      sourceId != null &&
      (characterSourceUsage.get(sourceId) ?? 0) > 1
    )
  }
  const isPassthrough = (candidate: AnchorAssetCandidate): boolean =>
    !requiresSubjectIsolation(candidate) &&
    (candidate.passthrough || shouldForceRaw(candidate, keepRawAssetIds))
  const eligibleCandidates = params.candidates.filter((candidate) => !isPassthrough(candidate))
  const passthroughCandidates = params.candidates.filter((candidate) => isPassthrough(candidate))
  const items = (
    await mapWithConcurrency(
      eligibleCandidates,
      UIP_ANCHOR_PROMPT_SPEC_CONCURRENCY,
      async (candidate) => {
        try {
          const sourceAssetIds = candidate.source_asset_ids ?? []
          const assetDescriptions = sourceAssetIds
            .map((sourceAssetId) => params.descriptionsById.get(sourceAssetId) ?? null)
            .filter((item): item is AssetDescriptionItem => Boolean(item))
          const sourceAssets = sourceAssetIds
            .map((sourceAssetId) => params.uploadedById.get(sourceAssetId) ?? null)
            .filter((item): item is UploadedAsset => Boolean(item))
          const requestContext = requestContextByAnchorId.get(candidate.anchor_id) ?? null
          // Same filter as Phase A (asset-manager): SVG / non-raster MIMEs
          // 400 on multimodal LLMs. Drop them from sourceContents; the
          // anchor still gets a prompt-spec, it just runs without source
          // image bytes. A later change will rasterize SVG sources upstream so
          // this branch becomes a no-op for SVG over time.
          const multimodalSourceAssets = sourceAssets.filter((asset) =>
            isMultimodalImageMimeType(asset.content_type),
          )
          if (multimodalSourceAssets.length < sourceAssets.length) {
            logger.info(
              `[uip-anchor-prompt-spec] skipped non-raster source assets anchorId=${candidate.anchor_id} total=${sourceAssets.length} kept=${multimodalSourceAssets.length}`,
            )
          }
          const sourceContents =
            multimodalSourceAssets.length > 0
              ? await Promise.all(
                  multimodalSourceAssets.map((sourceAsset) =>
                    uploadedAssetToContent(sourceAsset, params.storage),
                  ),
                )
              : []
          // Pick ONE reference basis, never blend the two (see
          // selectAnchorReferenceContents). When source photos exist we skip
          // reading the previous anchor entirely -- it is not used and the read
          // is a wasted storage fetch.
          const hasSourcePhoto = sourceContents.length > 0
          const previousAnchor = hasSourcePhoto
            ? null
            : findPreviousGeneratedAnchor({
                anchorId: candidate.anchor_id,
                existingSummary: params.existingSummary,
                plannerParams: params.plannerParams,
                requestContext,
              })
          const previousGeneratedPreviewContent = previousAnchor?.preview_relative_path
            ? await readAnchorImageContent({
                previewRelativePath: previousAnchor.preview_relative_path,
                storage: params.storage,
              })
            : null
          const contents = selectAnchorReferenceContents(
            sourceContents,
            previousGeneratedPreviewContent,
          )

          const promptSpecStartedAt = Date.now()
          logger.info(
            `[uip-anchor-prompt-spec] start anchorId=${candidate.anchor_id} hasSourceImages=${sourceAssets.length > 0} hasPreviewHint=${Boolean(previousGeneratedPreviewContent)}`,
          )
          const effectiveEditInstructions = resolveEffectiveEditInstructions(
            candidate,
            requestContext,
          )
          const basePrompt = buildAnchorPromptSpecPrompt({
            anchor: candidate,
            assetDescriptions,
            businessContext: params.businessContext,
            editInstructions: effectiveEditInstructions,
            effectiveStyleText: params.effectiveStyleText,
            hasSourceImages: sourceAssets.length > 0,
            hasPreviousGeneratedAnchorPreviewHint: Boolean(previousGeneratedPreviewContent),
            voiceCharacterText: params.voiceCharacterText,
            worldBibleJson,
          })
          const resolvedGender = resolveAnchorGender({
            candidate,
            editInstructions: effectiveEditInstructions,
            voiceGender: params.voiceGender,
          })
          const runPromptSpec = (prompt: string) =>
            completion({
              models: PLANNER_TOOL_MODELS,
              prompt,
              contents,
              reasoningEffort: 'low',
              responseFormat: promptSpecSchema,
              task: 'user-intent-planner-anchor-prompt-spec',
              temperature: 0.1,
              timeout: 30_000,
            })

          let promptSpec = await runPromptSpec(basePrompt)
          // The model is asked to declare the gender it depicted, and the
          // declaration is compared to the resolved value by equality --
          // the prompt text is never parsed. One corrective retry, then we
          // persist and log: a wrong anchor is recoverable by the user, a
          // failed plan is not.
          if (
            isAnchorGenderMismatch({
              depicted: promptSpec.depicted_gender,
              resolved: resolvedGender,
            })
          ) {
            logger.warn(
              `[uip-anchor-prompt-spec] gender mismatch, retrying projectId=${params.sessionId} anchorId=${candidate.anchor_id} resolved=${resolvedGender.gender} basis=${resolvedGender.reason} depicted=${promptSpec.depicted_gender}`,
            )
            promptSpec = await runPromptSpec(
              `${basePrompt}${buildAnchorGenderCorrection(resolvedGender)}`,
            )
            if (
              isAnchorGenderMismatch({
                depicted: promptSpec.depicted_gender,
                resolved: resolvedGender,
              })
            ) {
              logger.error(
                `[uip-anchor-prompt-spec] gender mismatch persisted after retry projectId=${params.sessionId} anchorId=${candidate.anchor_id} resolved=${resolvedGender.gender} basis=${resolvedGender.reason} depicted=${promptSpec.depicted_gender}`,
              )
            }
          }
          logger.info(
            `[uip-anchor-prompt-spec] done durationMs=${Date.now() - promptSpecStartedAt} anchorId=${candidate.anchor_id}`,
          )

          // Verbatim text strings extracted from each source reference
          // image's `entities.brands_or_text` (produced earlier by
          // `describe_uploaded_images`). Phase C uses these to append a
          // runtime "render this text verbatim" directive so logo /
          // packaging / brand text on the user-uploaded reference is
          // preserved exactly instead of being rewritten by the image
          // generator. Mirrors story-mode `storage.ts:406` -> anchors.ts.
          //
          // Conditional spread keeps `printed_text` truly optional so the
          // passthrough stubs below (which never set `printed_text`)
          // remain assignable to AnchorAssetPromptSpec -- TS narrows the
          // mapWithConcurrency element type from the first return, so
          // emitting `printed_text: undefined` here would force the
          // property to be required (and break the stubs).
          const printedText = requiresSubjectIsolation(candidate)
            ? []
            : Array.from(
                new Set(
                  assetDescriptions
                    .flatMap((description) => description.entities.brands_or_text ?? [])
                    .map((value) => value.trim())
                    .filter((value) => value.length > 0),
                ),
              )

          return {
            anchor_id: candidate.anchor_id,
            label: candidate.label,
            generation_prompt: promptSpec.generation_prompt,
            is_multi_angle: candidate.is_multi_angle,
            passthrough: false,
            ...(promptSpec.depicted_gender ? { depicted_gender: promptSpec.depicted_gender } : {}),
            ...(printedText.length > 0 ? { printed_text: printedText } : {}),
            prompt_spec: promptSpec.prompt_spec,
            source_asset_id: candidate.source_asset_id,
            source_asset_ids: candidate.source_asset_ids ?? [],
            type: candidate.type,
          }
        } catch {
          return null
        }
      },
    )
  ).filter((item): item is AnchorAssetPromptSpec => Boolean(item))

  // Append passthrough stubs. They carry empty `generation_prompt` /
  // `prompt_spec` -- Phase C's passthrough fast path
  // (`copyPassthroughSourceToFinal`) consumes neither field, it just reads
  // `passthrough`, `source_asset_id(s)`, `anchor_id`, `label`, `type`.
  for (const candidate of passthroughCandidates) {
    items.push({
      anchor_id: candidate.anchor_id,
      generation_prompt: '',
      is_multi_angle: candidate.is_multi_angle,
      label: candidate.label,
      passthrough: true,
      prompt_spec: '',
      source_asset_id: candidate.source_asset_id,
      source_asset_ids: candidate.source_asset_ids ?? [],
      type: candidate.type,
    })
  }

  const promptSpecs: AnchorAssetPromptSpecsArtifact = {
    generated_at: new Date().toISOString(),
    items,
  }
  if (params.persist !== false) {
    await persistPlannerJsonArtifact(params.sessionId, UIP_ANCHOR_PROMPT_SPECS_PATH, promptSpecs)
    await persistPlannerJsonArtifact(
      params.sessionId,
      UIP_ANCHOR_GENERATION_PROMPTS_PATH,
      promptSpecs.items.map((item) => ({
        anchor_id: item.anchor_id,
        generation_prompt: item.generation_prompt,
      })),
    )
  }
  return promptSpecs
}

export function buildAnchorRequestContextByAnchorId(plannerParams: PlannerToolParams): Map<
  string,
  {
    editInstruction: null | string
    hasNewSourceImages: boolean
  }
> {
  const byId = new Map<
    string,
    {
      editInstruction: null | string
      hasNewSourceImages: boolean
    }
  >()

  if (plannerParams.scope !== 'ANCHOR_IDS') {
    return byId
  }

  for (const request of plannerParams.anchor_requests ?? []) {
    const anchorId = normalizeAnchorId(request.anchor_id)
    if (!anchorId || normalizeAnchorOperation(request.operation) === 'REMOVE_ANCHOR') {
      continue
    }

    const sourceAssetIds = normalizeSourceAssetIds({
      fallbackPrimary: request.source_asset_id,
      sourceAssetIds: request.source_asset_ids,
    })
    byId.set(anchorId, {
      editInstruction: request.edit_instruction?.trim() || null,
      hasNewSourceImages: sourceAssetIds.length > 0,
    })
  }

  return byId
}

export function findPreviousGeneratedAnchor(params: {
  anchorId: string
  existingSummary: AnchorAssetsSummary | null
  plannerParams: PlannerToolParams
  requestContext: null | {
    editInstruction: null | string
    hasNewSourceImages: boolean
  }
}): AnchorAssetSummaryItem | null {
  if (params.plannerParams.scope !== 'ANCHOR_IDS') {
    return null
  }

  if (params.requestContext?.hasNewSourceImages) {
    return null
  }

  return (
    params.existingSummary?.anchors.find(
      (anchor) => anchor.anchor_id === params.anchorId && anchor.status === 'ready',
    ) ?? null
  )
}

/**
 * Full ordered edit-instruction list to feed the anchor prompt spec.
 * Prefers the candidate's code-owned history (oldest first), falling
 * back to its single `edit_instruction` for pre-history candidates, and
 * appends this turn's request when it isn't already the last entry (the
 * candidate may not have been re-resolved before generation). Phase B
 * applies them in order, so sequential edits accumulate rather than the
 * latest one dropping earlier appearance changes.
 */
export async function mergePersistedPromptSpecs(
  sessionId: string,
  nextPromptSpecs: AnchorAssetPromptSpecsArtifact,
  params: { activeAnchorIds: Set<string> },
): Promise<AnchorAssetPromptSpecsArtifact> {
  const persistedPromptSpecs = await loadPlannerJsonArtifact<AnchorAssetPromptSpecsArtifact>(
    sessionId,
    UIP_ANCHOR_PROMPT_SPECS_PATH,
  )
  const mergedById = new Map(
    (persistedPromptSpecs?.items ?? []).map((item) => [item.anchor_id, item] as const),
  )

  for (const item of nextPromptSpecs.items) {
    mergedById.set(item.anchor_id, item)
  }

  const items = [...mergedById.values()]
    .filter((item) => params.activeAnchorIds.has(item.anchor_id))
    .sort((left, right) => left.anchor_id.localeCompare(right.anchor_id))

  return {
    generated_at: nextPromptSpecs.generated_at,
    items,
  }
}

export async function persistDerivedAnchorArtifacts(params: {
  assetPlan: { candidates: AnchorAssetCandidate[] }
  promptSpecs: AnchorAssetPromptSpecsArtifact
  sessionId: string
  storage: ReturnType<typeof createPlannerStorage>
  summary: AnchorAssetsSummary
}): Promise<void> {
  const activeAnchorIds = new Set(
    params.assetPlan.candidates.map((candidate) => candidate.anchor_id),
  )
  const mergedPromptSpecs = await mergePersistedPromptSpecs(params.sessionId, params.promptSpecs, {
    activeAnchorIds,
  })

  await persistPlannerJsonArtifact(
    params.sessionId,
    UIP_ANCHOR_PROMPT_SPECS_PATH,
    mergedPromptSpecs,
  )
  await persistPlannerJsonArtifact(
    params.sessionId,
    UIP_ANCHOR_GENERATION_PROMPTS_PATH,
    mergedPromptSpecs.items.map((item) => ({
      anchor_id: item.anchor_id,
      generation_prompt: item.generation_prompt,
    })),
  )
  await persistPlannerJsonArtifact(params.sessionId, UIP_ANCHOR_FINAL_INDEX_PATH, {
    assets: params.summary.anchors
      .filter((anchor) => anchor.status === 'ready')
      .map((anchor) => ({
        anchor_id: anchor.anchor_id,
        anchor_uri: anchor.preview_relative_path
          ? params.storage.getFullPath(anchor.preview_relative_path)
          : null,
        label: anchor.label,
        source_asset_id: anchor.source_asset_id,
        source_asset_ids: anchor.source_asset_ids,
        status: 'success' as const,
        type: anchor.type,
      })),
    generated_at: params.summary.generated_at,
  })
}

export function resolveEffectiveEditInstructions(
  candidate: AnchorAssetCandidate,
  requestContext: null | { editInstruction: null | string },
): string[] {
  const history =
    candidate.edit_instructions && candidate.edit_instructions.length > 0
      ? [...candidate.edit_instructions]
      : candidate.edit_instruction
        ? [candidate.edit_instruction]
        : []
  const current = requestContext?.editInstruction ?? null
  if (current && history.at(-1) !== current) {
    history.push(current)
  }
  return history
}

/**
 * Load a previously generated anchor preview image from storage as LLM
 * `Content` (base64 data URL), or null when the file is absent.
 */
export async function readAnchorImageContent(params: {
  previewRelativePath: string
  storage: ReturnType<typeof createPlannerStorage>
}): Promise<Content | null> {
  const exists = await params.storage.exists(params.previewRelativePath)
  if (!exists) {
    return null
  }

  const imageBuffer = await params.storage.readFile(params.previewRelativePath)
  return {
    type: 'image_url',
    imageUrl: `data:image/png;base64,${imageBuffer.toString('base64')}`,
  }
}

/**
 * Pick the ONE reference basis for an anchor (re)generation -- never blend.
 * Source photos win: if any uploaded source image is present, regenerate from it
 * alone and do NOT also attach the previous generated anchor. Blending drags
 * every edit toward the prior (possibly drifted) render, compounding style drift
 * -- e.g. a photo-sourced character sliding into full illustration across a
 * wardrobe edit. The uploaded photo is the stable identity
 * anchor. Only when there is no source photo does the previous anchor serve as
 * the reference (an AI-invented character's sole identity carrier).
 */
export function selectAnchorReferenceContents(
  sourceContents: Content[],
  previousGeneratedPreviewContent: Content | null,
): Content[] | undefined {
  if (sourceContents.length > 0) {
    return sourceContents
  }
  return previousGeneratedPreviewContent ? [previousGeneratedPreviewContent] : undefined
}

// A keep-raw candidate only forces passthrough when the image the passthrough
// stub will actually copy -- source_asset_id -- is in the keep-raw set. Null
// source can never be passthrough. Matching source_asset_id (not
// source_asset_ids[0]) keeps the verdict coherent with the copied bytes.
function shouldForceRaw(candidate: AnchorAssetCandidate, keepRawAssetIds: Set<string>): boolean {
  const sourceId = candidate.source_asset_id
  return sourceId != null && keepRawAssetIds.has(sourceId)
}
