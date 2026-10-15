import {
  type GlobalConstraints,
  GlobalConstraintsSchema,
} from '@agent-lib/agents/visual-script/visual-script-type'
import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import type { Content } from '@reelmakeeasy/common/llm'
import type {
  LongTakeAnchorIndex,
  LongTakeVisualScriptItem,
} from '@reelmakeeasy/common/long-take/types'
import { LongTakeAnchorIndexSchema } from '@reelmakeeasy/common/long-take/types'
import { z } from 'zod'

import type { LongTakePromptRoute } from '../../long-take-prompt-router'
import type { LongTakeAnchorAssetTask } from '../../workflows/long-take/types'
import { type LongTakeAssetManifestOutput } from '../long-take-experts-analysis'
import { type LongTakeUserAssetsAnalysisOutput } from '../long-take-user-assets-analysis'

import {
  clearLongTakeAnchorMetaLookupCache,
  detectCrowdScene,
  extractMaxFigureCount,
  type LongTakeCharacterAnchors,
} from './anchor-meta'
import { formatError, formatLogFields, logger } from './common'
import {
  appendKeyframeDirectives,
  appendOptionalKeyframeDirectives,
  buildLongTakeKeyframeDirectives,
  mentionsHumanFigure,
  resolveNonEnglishScriptLanguage,
} from './keyframe-directives'
import {
  BRAND_PRODUCT_PRESERVATION_DIRECTIVE,
  buildKeyframeContextLines,
  buildRoutedLongTakeKeyframePrompt,
  hasPluralizedAnchorKeyword,
} from './keyframe-prompt-routing'
import {
  readLongTakeAssetManagerOutput,
  readLongTakeAssetManifestOutput,
  readLongTakeUserAssetContent,
  readLongTakeUserAssetUnderstandingCatalogForAnalysis,
} from './storage-read'

export * from './storage-read'

export type LongTakeLegacyVisualScriptItem = {
  audio: string
  visual: LongTakeVisualChoice
}

export type LongTakeVisualChoice = {
  aesthetic_mode?: string
  availability?: string
  core_description?: null | string
  description?: null | string
  entry_action?: null | string
  exit_action?: null | string
  expression_type?: string
  notes?: LongTakeVisualNotes | null
}

export type LongTakeVisualNotes = string[]

export type {
  LongTakeAnchorIndex,
  LongTakeVisualScriptItem,
} from '@reelmakeeasy/common/long-take/types'

export function createLongTakeStorage(projectId: string): ProjectStore {
  return new ProjectStore(projectId)
}

export {
  LongTakeAnchorIndexSchema,
  LongTakeVisualScriptSchema,
} from '@reelmakeeasy/common/long-take/types'

export const LongTakeLegacyVisualScriptSchema = z.array(
  z.object({
    audio: z.string(),
    visual: z.object({
      expression_type: z.string().nullable().default(null),
      aesthetic_mode: z.string().nullable().default(null),
      description: z.string().nullable().default(null),
      core_description: z.string().nullable().default(null),
      entry_action: z.string().nullable().default(null),
      exit_action: z.string().nullable().default(null),
      availability: z.string().nullable().default(null),
      notes: z.array(z.string()).nullable().default(null),
    }),
  }),
)

const LongTakeVideoPromptItemSchema = z
  .object({
    prompt: z.string(),
    requires_lip_sync: z.boolean().default(false),
    shot_id: z.string(),
  })
  .strict()

export const LongTakeVideoPromptSchema = z
  .object({
    shots: z.array(LongTakeVideoPromptItemSchema),
  })
  .strict()

export const LongTakeKeyframePromptsModelOutputSchema = z.object({
  shots: z
    .array(
      z.object({
        prompt_base: z.string(),
        shot_id: z.string(),
      }),
    )
    .default([]),
})

export const LongTakeKeyframePromptsOutputSchema = z.object({
  shots: z
    .array(
      z.object({
        prompt_base: z.string(),
        shot_id: z.string(),
        used_asset_id: z.array(z.string()).default([]),
      }),
    )
    .default([]),
})

export type LongTakeKeyframePromptsModelOutput = z.infer<
  typeof LongTakeKeyframePromptsModelOutputSchema
>
export type LongTakeKeyframePromptsOutput = z.infer<typeof LongTakeKeyframePromptsOutputSchema>
export type LongTakeRuntimeMetadata = {
  gitSha: null | string
  recordedAt: string
  workerType: string
}

export type LongTakeStyleConversionOutput = {
  style_conversion_prompt: string
  used_original_style_text: string
}

export const LONG_TAKE_GENRE_CLASSIFICATION_PATH = 'long_take/genre_classification.json'
export const LONG_TAKE_INTENT_ANALYSIS_PATH = 'long_take/intent_analysis.json'
export const LONG_TAKE_KEYFRAME_EXPANSIONS_DIR = 'long_take/keyframe_expansions'
export const LONG_TAKE_MOTION_PROMPTS_PATH = 'long_take/motion_prompts.json'
export const LONG_TAKE_VISUAL_TREATMENT_PATH = 'long_take/visual_treatment.json'
export const LONG_TAKE_PROMPT_CLASSIFICATION_PATH = 'long_take/prompt_classification_raw.json'
export const LONG_TAKE_PROMPT_ROUTE_CLASSIFICATION_PATH = 'long_take/prompt_route.json'
export const LONG_TAKE_STYLE_ANALYSIS_PATH = 'long_take/style_analysis.json'
export const LONG_TAKE_GLOBAL_CONSTRAINTS_PATH = 'long_take/global_constraints.json'
export const LONG_TAKE_PIPELINE_CONTEXT_PATH = 'long_take/pipeline_context.json'
export const LONG_TAKE_RUNTIME_METADATA_PATH = 'long_take/runtime_metadata.json'
export const LONG_TAKE_ANCHOR_ASSETS_DIR = 'long_take/anchors'
export const LONG_TAKE_ANCHOR_ASSET_TASKS_PATH = `${LONG_TAKE_ANCHOR_ASSETS_DIR}/asset_tasks.json`
// Sentinel written at confirm time when UIP has already produced and stored
// styled+raw anchor indices. Presence of this file signals
// `generateLongTakeAnchorAssets` to short-circuit and reuse the pre-generated
// indices instead of overwriting them. Without this guard, a workflow re-run
// would replace UIP's planner-styled anchors with legacy expert-pipeline
// regenerations and drop passthrough markers along the way.
export const LONG_TAKE_ANCHOR_UIP_SENTINEL_PATH = `${LONG_TAKE_ANCHOR_ASSETS_DIR}/.uip_pre_generated.json`
export const LONG_TAKE_ANCHOR_RAW_DIR = `${LONG_TAKE_ANCHOR_ASSETS_DIR}/raw`
export const LONG_TAKE_ANCHOR_RAW_INDEX_PATH = `${LONG_TAKE_ANCHOR_RAW_DIR}/index.json`
export const LONG_TAKE_ANCHOR_STYLE_CONVERSION_PATH = `${LONG_TAKE_ANCHOR_ASSETS_DIR}/style_conversion.json`
export const LONG_TAKE_ANCHOR_STYLED_DIR = `${LONG_TAKE_ANCHOR_ASSETS_DIR}/styled`
export const LONG_TAKE_ANCHOR_STYLED_INDEX_PATH = `${LONG_TAKE_ANCHOR_STYLED_DIR}/index.json`
export const LONG_TAKE_KEYFRAME_PROMPTS_PATH = 'long_take/keyframe_prompts.json'
export const LONG_TAKE_KEYFRAME_FINAL_PROMPTS_PATH = 'long_take/keyframe_final_prompts.json'
export const LONG_TAKE_VOICE_CHARACTER_PATH = 'long_take/voice_character.json'
// Validation-only (no pipeline consumer): YAMNet's perceived vocal gender, persisted by the
// detectIfMusic activity so `project.long_take.completed` can log it next to Gemini's
// perceivedGender. Read best-effort at completion; never gates generation.
export const LONG_TAKE_VOCAL_GENDER_VALIDATION_PATH = 'long_take/vocal_gender_validation.json'

const LONG_TAKE_GLOBAL_CONTEXT_CACHE_TTL_MS = 10 * 60 * 1000
const LONG_TAKE_GLOBAL_CONTEXT_CACHE_MISS_TTL_MS = 60 * 1000
const LONG_TAKE_ANCHOR_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000

export type LongTakeKeyframeGlobalContext = {
  brandScope?: string
  geoScope?: string
  keyEntities: string[]
  scriptLanguage?: string
  timeScope?: string
  topic?: string
}

const longTakeGlobalContextCache = new Map<
  string,
  { context: LongTakeKeyframeGlobalContext | null; expiresAt: number }
>()

const longTakeAnchorLookupCache = new Map<
  string,
  { byAssetId: Map<string, string>; expiresAt: number }
>()

export function clearLongTakeAnchorLookupCache(projectId: string): void {
  longTakeAnchorLookupCache.delete(projectId)
  clearLongTakeAnchorMetaLookupCache(projectId)
}

// The classification schema lives in @reelmakeeasy/common; these aliases keep long-take call sites and stored-JSON parsing untouched.
export type { ContentClassification as LongTakePromptClassification } from '@reelmakeeasy/common/classification/content-classification'
export { ContentClassificationSchema as LongTakePromptClassificationSchema } from '@reelmakeeasy/common/classification/content-classification'

const IGNORED_GLOBAL_CONSTRAINT_VALUES = new Set([
  'n/a',
  'na',
  'none',
  'not applicable',
  'not provided',
  'not specified',
  'null',
  'unknown',
  'unspecified',
])

const LONG_TAKE_VISUAL_SCRIPT_TEMPERATURE_DEFAULT = 0
const LONG_TAKE_VISUAL_SCRIPT_TEMPERATURE_MIN = 0
const LONG_TAKE_VISUAL_SCRIPT_TEMPERATURE_MAX = 1

type AssetManifestEntry = LongTakeAssetManifestOutput['asset_manifest'][number]

type UserFileEntry = LongTakeUserAssetsAnalysisOutput['files'][number]

export function buildFallbackLongTakeKeyframePromptsOutput(
  visualScript: LongTakeVisualScriptItem[],
): LongTakeKeyframePromptsOutput {
  return {
    shots: visualScript.map((item, index) => ({
      prompt_base: buildKeyframePrompt(item, 'Visual representation'),
      shot_id: item.shot_id?.trim() || `LT_S${index + 1}`,
      used_asset_id: item.used_asset_id || [],
    })),
  }
}
export function buildKeyframePrompt(
  item: LongTakeVisualScriptItem | undefined,
  fallback: string,
): string {
  if (!item) {
    return fallback
  }
  const visual = item.visual
  if (!visual) {
    return fallback
  }
  return visual.core_description || visual.description || fallback
}

export async function buildLongTakeAnchorAssetTasks(
  storage: ProjectStore,
): Promise<LongTakeAnchorAssetTask[]> {
  const [assetManifest, assetManagerOutput, userAssetContent, userAssetUnderstanding] =
    await Promise.all([
      readLongTakeAssetManifestOutput(storage),
      readLongTakeAssetManagerOutput(storage),
      readLongTakeUserAssetContent(storage),
      readLongTakeUserAssetUnderstandingCatalogForAnalysis(storage),
    ])
  const assetPrompts = assetManagerOutput.prompts || []
  const fileById = new Map(userAssetContent.files.map((file) => [file.file_id, file]))
  const manifestById = new Map(assetManifest.asset_manifest.map((item) => [item.asset_id, item]))
  const printedTextByFileId = new Map(
    userAssetUnderstanding
      .filter((entry) => entry.entities.brands_or_text.length > 0)
      .map((entry) => [entry.file_id, entry.entities.brands_or_text] as const),
  )

  const tasks = assetPrompts
    .map((item) =>
      buildAnchorAssetTaskItem(
        item,
        manifestById.get(item.asset_id),
        fileById,
        printedTextByFileId,
      ),
    )
    .filter((item): item is LongTakeAnchorAssetTask => item !== null)

  // When multiple assets share the same source file, disable passthrough
  // so each asset gets its own generated anchor instead of reusing the same image.
  // This handles cases like a single uploaded image containing multiple characters.
  const fileUsageCount = new Map<string, number>()
  for (const task of tasks) {
    for (const fid of task.source_file_ids) {
      fileUsageCount.set(fid, (fileUsageCount.get(fid) || 0) + 1)
    }
  }
  for (const task of tasks) {
    if (
      task.source_passthrough &&
      task.source_file_ids.some((fid) => (fileUsageCount.get(fid) || 0) > 1)
    ) {
      task.source_passthrough = false
    }
  }

  return tasks
}

export function buildLongTakeEmptyAnchorIndex(): LongTakeAnchorIndex {
  return { assets: [] }
}

export function buildLongTakeFallbackStyleConversionOutput(
  styleText?: string,
): LongTakeStyleConversionOutput {
  return {
    style_conversion_prompt: 'none',
    used_original_style_text: styleText?.trim() || '',
  }
}

function buildAnchorAssetTaskItem(
  item: { asset_id: string; prompt_text: string; type: LongTakeAnchorAssetTask['type'] },
  manifestAsset: AssetManifestEntry | undefined,
  fileById: Map<string, UserFileEntry>,
  printedTextByFileId: Map<string, string[]>,
): LongTakeAnchorAssetTask | null {
  const resolvedType = manifestAsset?.type || item.type
  const { keyword, properName, visualReference } = resolveManifestMetadata(
    manifestAsset,
    item.asset_id,
  )
  const source = manifestAsset?.source ?? null

  if (!isLongTakeAnchorTaskEligible(resolvedType, source)) {
    return null
  }

  if (source !== 'USER_FILE') {
    return {
      asset_id: item.asset_id,
      keyword,
      proper_name: properName,
      prompt_text: item.prompt_text,
      reference_image_uris: [],
      source_file_ids: [],
      source_image_uris: [],
      type: resolvedType,
      visual_reference: visualReference,
    }
  }

  const sourceFileId = manifestAsset?.source_file_id?.trim() || ''
  if (!sourceFileId) {
    throw new Error(`Missing source_file_id for USER_FILE asset ${item.asset_id}`)
  }

  const file = fileById.get(sourceFileId)
  if (!file?.storage_uri) {
    throw new Error(`Invalid source_file_id ${sourceFileId} for USER_FILE asset ${item.asset_id}`)
  }

  // Manifest-declared passthrough wins over filename heuristics: the UIP
  // planner / story-mode expert can flag passthrough explicitly (e.g. for
  // brand logos that don't match the "logo image" filename pattern).
  const sourcePassthrough =
    manifestAsset?.source_passthrough ?? isLogoAssetShortname(file.shortname)

  const printedText = printedTextByFileId.get(sourceFileId) ?? []

  return {
    asset_id: item.asset_id,
    keyword,
    printed_text: printedText.length > 0 ? printedText : undefined,
    proper_name: properName,
    prompt_text: item.prompt_text,
    reference_image_uris: [file.storage_uri],
    source_file_ids: [sourceFileId],
    source_image_uris: [file.storage_uri],
    source_passthrough: sourcePassthrough,
    type: resolvedType,
    visual_reference: visualReference,
  }
}

function isLogoAssetShortname(shortname: string): boolean {
  return shortname.toLowerCase().startsWith('logo image')
}

function isLongTakeAnchorTaskEligible(
  type: LongTakeAnchorAssetTask['type'],
  _source: AssetManifestEntry['source'],
): boolean {
  if (type === 'Character') {
    return true
  }
  if (type === 'Prop') {
    // All Props in the manifest are now anchor-eligible (manifest only contains necessary Props)
    return true
  }
  // Sets are never in the manifest, but guard defensively
  return false
}

function resolveManifestMetadata(
  manifestAsset: AssetManifestEntry | undefined,
  assetId: string,
): { keyword: string; properName: null | string; visualReference: string } {
  return {
    keyword: manifestAsset?.keyword?.trim() || assetId,
    properName: manifestAsset?.proper_name?.trim() || null,
    visualReference: manifestAsset?.visual_reference?.trim() || '',
  }
}

const WITH_TITLE_STYLE_NAMES = new Set(['Blue Vox', 'Economic', 'Halftone', 'Schematic', 'Vox'])
// Share of title-eligible keyframes rendered with a headline.
const HEADLINE_RATE = 0.5

export async function buildAnchorImageContentsForVisualScript(
  storage: ProjectStore,
  projectId: string,
): Promise<Content[]> {
  const anchorLookup = await getLongTakeAnchorLookup(storage, projectId)

  const contents: Content[] = []
  for (const [assetId, anchorUri] of anchorLookup) {
    contents.push(
      { type: 'text', text: `[asset_id: ${assetId}]` },
      { type: 'image_url', imageUrl: anchorUri },
    )
  }
  return contents
}

/**
 * The anti-collage clause and the identity clause, as one string -- the shape
 * this has on the old path. The authored prompt_base carries both once the
 * rework is on.
 */
const COMPOSITION_AND_IDENTITY_DIRECTIVE =
  'Composition directive: Generate a single cohesive scene filling the entire frame. Do NOT produce a grid, collage, split-screen, multi-panel layout, or repeated variations. The reference images provide character, style, and named-asset identity consistency — do not replicate their layout. When the shot names or depicts a referenced person, character, product, logo, UI, or object, render it as the same specific instance from the reference image, not merely the same category; preserve identity-critical features such as face, body shape, hairstyle, outfit, silhouette, colors, logos, labels, UI layout, packaging, text, distinctive markings, and — for a product or object — its exact material and finish, form, proportions, and part structure (do not swap materials such as metal for glass or reshape its parts) unless the shot explicitly requests a change.'

export function buildLongTakeKeyframePrompt(params: {
  basePrompt: string
  /**
   * Character anchors bound to the shot. `count` (distinct asset_ids) gates
   * the anti-cloning directive; `keywords` (deduped) feeds plural-form text
   * matching. Use collectCharacterAnchors() to populate.
   */
  characterAnchors?: LongTakeCharacterAnchors
  globalContext: LongTakeKeyframeGlobalContext | null
  hasAnchorReference?: boolean
  /**
   * True when at least one bound anchor is a USER_FILE-sourced Prop. Gates
   * the brand-product preservation directive (Layer 2). Use
   * `hasUserFilePropAnchorReference()` from `./anchor-meta` to compute.
   * Optional so existing callers continue to compile; coerced internally.
   */
  hasUserFilePropAnchorReference?: boolean
  humanPresence?: LongTakeVisualScriptItem['human_presence']
  /**
   * False keeps today's appended block byte for byte: one welded
   * composition+identity paragraph, and the looser crowd rule.
   */
  keyframePromptReworkEnabled?: boolean
  promptRoute?: LongTakePromptRoute
  styleName?: string
  styleText?: string
}): {
  crowdScene: boolean
  fieldsUsed: string[]
  keyEntitiesCount: number
  prompt: string
  withTitle: boolean
} {
  const {
    basePrompt,
    characterAnchors,
    globalContext,
    hasAnchorReference,
    promptRoute,
    styleName,
    styleText,
  } = params
  const hasUserFilePropAnchor = Boolean(params.hasUserFilePropAnchorReference)
  const characterAnchorCount = characterAnchors?.count ?? 0
  const characterAnchorKeywords = characterAnchors?.keywords ?? []
  const fieldsUsed = collectLongTakeGlobalContextFieldKeys(globalContext)
  const contextLines = buildKeyframeContextLines(globalContext, { promptRoute })
  const keyframeDirectives = buildLongTakeKeyframeDirectives({
    basePrompt,
    hasAnchorReference,
    hasCharacterAnchorReference: characterAnchorCount > 0,
    humanPresence: params.humanPresence,
    promptRoute,
  })

  const isTitleEligible = Boolean(styleName && WITH_TITLE_STYLE_NAMES.has(styleName))
  const withTitle = isTitleEligible && Math.random() < HEADLINE_RATE

  const routedPrompt = buildRoutedLongTakeKeyframePrompt({
    basePrompt,
    characterAnchors,
    fieldsUsed,
    globalContext,
    hasAnchorReference,
    hasUserFilePropAnchorReference: hasUserFilePropAnchor,
    promptRoute,
    styleText,
    withTitle,
  })
  if (routedPrompt) {
    return appendOptionalKeyframeDirectives(routedPrompt, keyframeDirectives)
  }

  let prompt = basePrompt
  if (contextLines.length > 0 && !params.keyframePromptReworkEnabled) {
    prompt = [
      basePrompt,
      '',
      'World context (background reference — shot description takes priority; use only when relevant):',
      ...contextLines,
      // A cleanup proposed dropping this as boilerplate the authoring prompt's
      // "Incidental Text Removal" already applied. It does -- but not to every
      // prompt_base that reaches here: a shot the keyframe model returned nothing
      // for keeps its raw description, and a failed prompts call falls back to
      // raw descriptions for the whole project. Neither ever ran that rule, and
      // this is their only cover. Kept.
      '- Avoid incidental text: no corner date stamps, map annotations, geographic captions, or floating entity labels unless the shot description explicitly calls for typography as a dominant visual element.',
    ].join('\n')
  }

  const nonEnglishLanguage = resolveNonEnglishScriptLanguage(globalContext?.scriptLanguage)
  if (nonEnglishLanguage) {
    prompt = `${prompt}\nOn-screen text language: Render any visible text on the frame (signage, captions, headlines, posters, UI strings, brand names, large typographic anchors, incidental signage) in ${nonEnglishLanguage}. Do NOT default to English. Quoted text already present in the description above is authoritative — keep its spelling and language verbatim.`
  }

  if (withTitle) {
    const titleLanguageNote = nonEnglishLanguage
      ? ` The headline text must be written in ${nonEnglishLanguage}.`
      : ''
    prompt = `${prompt}\nTypography directive: Include one single dominant typographic element as the primary visual anchor of this frame — a bold word, short phrase, or large number occupying at least one-third of the frame area. No small scattered labels or annotation-style text.${titleLanguageNote}`
  }

  const styleSuffix = styleText?.trim()
  if (styleSuffix) {
    prompt = `${prompt}\nStylize the image with ${styleSuffix}`
  }

  // Both of these now reach the image model through the authored prompt_base
  // instead, so this only runs on the old path.
  //
  // An earlier revision split them into two directives, because the identity
  // half was the only thing in the whole appended block binding the frame to its
  // anchor and could not survive a trim of the anti-collage half. Moving the
  // block wholesale made that split unreachable, so it is gone and the original
  // single string is back.
  if (hasAnchorReference && !params.keyframePromptReworkEnabled) {
    prompt = `${prompt}\n${COMPOSITION_AND_IDENTITY_DIRECTIVE}`
  }

  // `detectCrowdScene` fires on any plural quantifier -- several,
  // many, dozens, "some <plural>" -- with no check that the noun is a person. It
  // fired on a production shot whose only plural was soap bubbles, spending 496
  // characters instructing the model to vary their faces and facial hair. The
  // shot now has to actually mention a human figure before a directive about
  // faces, builds and facial hair is worth spending.
  //
  // Deliberately NOT the routed builders' rule, which additionally demands a
  // pluralized anchor keyword or an explicit figure count. That trades this false
  // positive for a false negative: "several stylized sailors" over anchors named
  // captain / first mate / cook is exactly the case anti-cloning exists for, and
  // the routed rule drops it.
  // `detectCrowdScene` answers "is something plural here" three ways, and only
  // two of them are loose. The anchor-keyword path ("sailors" where "sailor" is
  // a bound CHARACTER anchor) is about people by construction and must not be
  // filtered -- an anchor keyworded `crewmate` or `villager` is not in the
  // human-figure word list, and gating it out would drop the exact case
  // anti-cloning exists for. Only the generic quantifier and numeral
  // paths need the shot to actually name a person.
  const mentionsPeople =
    !params.keyframePromptReworkEnabled ||
    hasPluralizedAnchorKeyword(basePrompt, characterAnchorKeywords) ||
    mentionsHumanFigure(basePrompt)
  const detectedCrowdScene =
    Boolean(hasAnchorReference) &&
    characterAnchorCount > 0 &&
    mentionsPeople &&
    detectCrowdScene(basePrompt, characterAnchorKeywords)

  // When the prompt names an explicit character figure count (e.g. "three
  // girls") and we already have at least that many distinct character anchors,
  // every figure can be grounded on its own reference -- anti-cloning would
  // force the model to invent variation away from the named identities (the
  // failure mode for The Comets). Skip the directive in that case;
  // otherwise keep it. Object plurals like "12 signs" or "dozens of barrels"
  // do NOT contribute to the figure count -- only character-related plurals
  // (or pluralized anchor keywords) do.
  const explicitFigureCount = extractMaxFigureCount(basePrompt, characterAnchorKeywords)
  const sufficientAnchorsForFigureCount =
    explicitFigureCount > 0 && characterAnchorCount >= explicitFigureCount

  const crowdScene = detectedCrowdScene && !sufficientAnchorsForFigureCount

  if (crowdScene) {
    prompt = `${prompt}\nAnti-cloning directive: Each reference image depicts ONE specific individual, not a template for a character type. If the scene contains multiple figures of the same type (e.g., "several sailors", "a crowd", "a group of people"), the referenced individual appears at MOST ONCE — every other similar figure must be a visually distinct person with a different face, age, build, hair, facial hair, and clothing variations. Do NOT duplicate, mirror, or re-skin the reference across multiple figures.`
  }

  // Layer 2: brand-product preservation. Placed last so it's the freshest
  // instruction the model attends to. Fires only for shots that bind at
  // least one USER_FILE-sourced Prop -- gated upstream by
  // hasUserFilePropAnchorReference() in anchor-meta.ts so non-USER_FILE
  // anchors and uploaded characters are unaffected.
  if (hasUserFilePropAnchor) {
    prompt = `${prompt}\n${BRAND_PRODUCT_PRESERVATION_DIRECTIVE}`
  }

  return {
    crowdScene,
    fieldsUsed,
    keyEntitiesCount: globalContext?.keyEntities.length || 0,
    prompt: appendKeyframeDirectives(prompt, keyframeDirectives),
    withTitle,
  }
}

export async function getLongTakeAnchorLookup(
  storage: ProjectStore,
  projectId: string,
): Promise<Map<string, string>> {
  const now = Date.now()
  const cached = longTakeAnchorLookupCache.get(projectId)
  if (cached && cached.expiresAt > now) {
    return cached.byAssetId
  }

  const lookup = new Map<string, string>()
  const [styledIndex, rawIndex] = await Promise.all([
    readLongTakeAnchorIndex(storage, LONG_TAKE_ANCHOR_STYLED_INDEX_PATH),
    readLongTakeAnchorIndex(storage, LONG_TAKE_ANCHOR_RAW_INDEX_PATH),
  ])
  ingestAnchorIndexIntoLookup(lookup, styledIndex)
  ingestAnchorIndexIntoLookup(lookup, rawIndex)

  longTakeAnchorLookupCache.set(projectId, {
    byAssetId: lookup,
    expiresAt: now + LONG_TAKE_ANCHOR_LOOKUP_CACHE_TTL_MS,
  })
  return lookup
}

export function getLongTakeGlobalContextFieldKeys(
  globalContext: LongTakeKeyframeGlobalContext | null,
): string[] {
  return collectLongTakeGlobalContextFieldKeys(globalContext)
}

export async function getLongTakeKeyframeGlobalContext(
  storage: ProjectStore,
  projectId: string,
): Promise<LongTakeKeyframeGlobalContext | null> {
  const now = Date.now()
  const cached = longTakeGlobalContextCache.get(projectId)
  if (cached && cached.expiresAt > now) {
    return cached.context
  }

  try {
    const payload = await storage.readJsonFile<unknown>(LONG_TAKE_GLOBAL_CONSTRAINTS_PATH)
    const parsed = GlobalConstraintsSchema.safeParse(payload)
    if (!parsed.success) {
      longTakeGlobalContextCache.set(projectId, {
        context: null,
        expiresAt: now + LONG_TAKE_GLOBAL_CONTEXT_CACHE_MISS_TTL_MS,
      })
      logger.warn(
        `[long-take] Invalid global constraints payload for keyframe prompt ${formatLogFields({
          projectId,
          path: LONG_TAKE_GLOBAL_CONSTRAINTS_PATH,
          issueCount: parsed.error.issues.length,
        })}`,
      )
      return null
    }

    const context = buildLongTakeKeyframeGlobalContext(parsed.data)
    longTakeGlobalContextCache.set(projectId, {
      context,
      expiresAt:
        now +
        (context
          ? LONG_TAKE_GLOBAL_CONTEXT_CACHE_TTL_MS
          : LONG_TAKE_GLOBAL_CONTEXT_CACHE_MISS_TTL_MS),
    })
    return context
  } catch (error) {
    longTakeGlobalContextCache.set(projectId, {
      context: null,
      expiresAt: now + LONG_TAKE_GLOBAL_CONTEXT_CACHE_MISS_TTL_MS,
    })
    logger.warn(
      `[long-take] Failed to load global constraints for keyframe prompt ${formatLogFields({
        projectId,
        path: LONG_TAKE_GLOBAL_CONSTRAINTS_PATH,
        err: formatError(error),
      })}`,
    )
    return null
  }
}

export function normalizeGlobalConstraintKeyEntities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const deduped = new Set<string>()
  for (const entity of value) {
    const normalized = normalizeGlobalConstraintText(entity)
    if (!normalized) {
      continue
    }
    deduped.add(normalized)
    if (deduped.size >= 5) {
      break
    }
  }
  return Array.from(deduped)
}

export function normalizeGlobalConstraintText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned) {
    return undefined
  }
  if (IGNORED_GLOBAL_CONSTRAINT_VALUES.has(cleaned.toLowerCase())) {
    return undefined
  }
  return cleaned
}

/**
 * Join the model's authored prompts back onto the visual script.
 *
 * A shot the model returned nothing for keeps its raw description as
 * `prompt_base`. That renders, but it is the pre-authoring text -- none of the
 * style meshing, richness or writing order the prompt asked for. Nothing else
 * notices: the JSON is valid, the shot count is right, no error is thrown, and
 * the artifact looks complete. So the substituted ids come back with the output
 * and the caller reports them; they are the only evidence it happened.
 */
export function normalizeLongTakeKeyframePromptsOutput(params: {
  modelOutput: LongTakeKeyframePromptsModelOutput
  visualScript: LongTakeVisualScriptItem[]
}): { output: LongTakeKeyframePromptsOutput; unauthoredShotIds: string[] } {
  const { modelOutput, visualScript } = params
  const byShotId = new Map(
    (modelOutput.shots || [])
      .map((item) => [item.shot_id?.trim(), item.prompt_base?.trim()] as const)
      .filter((item): item is [string, string] => Boolean(item[0] && item[1])),
  )

  const unauthoredShotIds: string[] = []
  const shots = visualScript.map((item, index) => {
    const shotId = item.shot_id?.trim() || `LT_S${index + 1}`
    const authored = byShotId.get(shotId)
    if (!authored) {
      unauthoredShotIds.push(shotId)
    }
    return {
      prompt_base: authored || buildKeyframePrompt(item, 'Visual representation'),
      shot_id: shotId,
      used_asset_id: item.used_asset_id || [],
    }
  })

  return { output: { shots }, unauthoredShotIds }
}

export async function readLongTakeAnchorIndex(
  storage: ProjectStore,
  pathName: string,
): Promise<LongTakeAnchorIndex> {
  try {
    const payload = await storage.readJsonFile<unknown>(pathName)
    return LongTakeAnchorIndexSchema.parse(payload)
  } catch {
    return buildLongTakeEmptyAnchorIndex()
  }
}

export async function readLongTakeKeyframePromptOverrides(
  storage: ProjectStore,
): Promise<Map<string, string>> {
  try {
    const payload = await storage.readJsonFile<unknown>(LONG_TAKE_KEYFRAME_PROMPTS_PATH)
    const parsed = LongTakeKeyframePromptsOutputSchema.parse(payload)
    return new Map(
      parsed.shots
        .map((item) => [item.shot_id?.trim(), item.prompt_base?.trim()] as const)
        .filter((item): item is [string, string] => Boolean(item[0] && item[1])),
    )
  } catch {
    return new Map()
  }
}

export function resolveLongTakeVisualScriptTemperature(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return LONG_TAKE_VISUAL_SCRIPT_TEMPERATURE_DEFAULT
  }
  return Math.min(
    LONG_TAKE_VISUAL_SCRIPT_TEMPERATURE_MAX,
    Math.max(LONG_TAKE_VISUAL_SCRIPT_TEMPERATURE_MIN, value),
  )
}

function buildLongTakeKeyframeGlobalContext(
  globalConstraints: GlobalConstraints,
): LongTakeKeyframeGlobalContext | null {
  const brandScope = normalizeGlobalConstraintText(globalConstraints.brand_scope)
  const keyEntities = normalizeGlobalConstraintKeyEntities(globalConstraints.key_entities)
  const geoScope = normalizeGlobalConstraintText(globalConstraints.geo_scope)
  const timeScope = normalizeGlobalConstraintText(globalConstraints.time_scope)
  const scriptLanguage = normalizeGlobalConstraintText(globalConstraints.script_language)
  const topic = normalizeGlobalConstraintText(globalConstraints.topic)
  if (!brandScope && !keyEntities.length && !geoScope && !timeScope && !scriptLanguage && !topic) {
    return null
  }
  return { brandScope, keyEntities, geoScope, scriptLanguage, timeScope, topic }
}

function collectLongTakeGlobalContextFieldKeys(
  globalContext: LongTakeKeyframeGlobalContext | null,
): string[] {
  if (!globalContext) {
    return []
  }
  const fields: string[] = []
  if (globalContext.keyEntities.length) {
    fields.push('key_entities')
  }
  if (globalContext.brandScope) {
    fields.push('brand_scope')
  }
  if (globalContext.geoScope) {
    fields.push('geo_scope')
  }
  if (globalContext.timeScope) {
    fields.push('time_scope')
  }
  if (globalContext.scriptLanguage) {
    fields.push('script_language')
  }
  if (globalContext.topic) {
    fields.push('topic')
  }
  return fields
}

function ingestAnchorIndexIntoLookup(
  lookup: Map<string, string>,
  index: LongTakeAnchorIndex,
): void {
  for (const item of index.assets || []) {
    const assetId = item.asset_id?.trim()
    if (!assetId || lookup.has(assetId)) {
      continue
    }
    const anchorUri = resolveItemAnchorUri(item)
    if (!anchorUri) {
      continue
    }
    lookup.set(assetId, anchorUri)
  }
}

function resolveItemAnchorUri(item: LongTakeAnchorIndex['assets'][number]): string | undefined {
  return (
    item.effective_anchor_uri?.trim() ||
    item.styled_anchor_uri?.trim() ||
    item.raw_anchor_uri?.trim() ||
    item.anchor_uri?.trim()
  )
}
