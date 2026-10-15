import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { genMessage } from '@reelmakeeasy/common/helpers/agent/gen-message'
import { completion } from '@reelmakeeasy/common/llm/completion'
import { renderPrompt } from '@reelmakeeasy/common/llm/prompt'
import { logger } from '@reelmakeeasy/common/logger'
import { LONG_TAKE_LIP_SYNC_VIDEO_VARIANTS_PATH } from '@reelmakeeasy/common/long-take/lip-sync-variants'
import {
  isLongVideoDuration,
  type LongVideoAttemptSource,
} from '@reelmakeeasy/common/story-mode/long-video-attribution'
import { sanitizeFilename } from '@reelmakeeasy/common/utils/browser-download-utils'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { storedFileVersion, toStoreUri } from '@reelmakeeasy/common/storage/stored-files'
import { truncateWithoutSplittingSurrogates } from '@reelmakeeasy/common/utils/text'
import { NotFoundException } from '@nestjs/common'
import type {
  LongTakeLipSyncVideoVariants,
  LongTakeScriptGeneratorPath,
  UpscaleOutcome,
} from '@shared/types/api/long-take'
import type { ProjectForBackend } from '@shared/types/api/project'
import { z } from 'zod'

import { LONG_TAKE_UPSCALE_TRACE_PATH } from '../long-take/long-take-helpers.util'
import type { PrismaService } from '../prisma/prisma.service'
import { deriveBrandTelemetry } from '../uip/uip-brand-telemetry'
import { normalizeTimeline } from '../uip/uip-timeline-transformers'

import { enhancerSystemPrompt } from './enhancer.prompt'
import { calculateShotStatisticsFromBestPlans } from './projects-lifecycle.util'

// ---------- getProjectMetadata (extracted from ProjectService) ----------

export type LongTakePromptRouteForTracking =
  | 'abstract'
  | 'ads-intangible'
  | 'ads-tangible'
  | 'general'
  | 'legacy'

const SCRIPT_GENERATOR_PATHS = new Set<LongTakeScriptGeneratorPath>([
  'agent_pipeline',
  'agent_pipeline_fallback',
  'audio_upload',
  'legacy',
  'passthrough',
])
const LONG_TAKE_PROMPT_ROUTES = new Set<LongTakePromptRouteForTracking>([
  'abstract',
  'ads-intangible',
  'ads-tangible',
  'general',
  'legacy',
])

export type ProjectMetadataResponse = {
  aspectRatio?: string
  assetLibraryEnabled?: boolean
  assetLibraryTransitionsCount?: number
  codeGenShotPercentage?: string
  fasterTtsApplied?: boolean
  fasterTtsEvaluated?: boolean
  fasterTtsPostWpm?: number
  fasterTtsPreWpm?: number
  fasterTtsRatio?: number
  fasterTtsSkipReason?: string
  fasterTtsStatus?: 'applied' | 'not_evaluated' | 'skipped'
  fasterTtsTargetWpm?: number
  fasterTtsWasCapped?: boolean
  finalLongVideo?: boolean
  fixTemplateShotPercentage?: string
  genAIShotPercentage?: string
  isBrandVideo?: boolean
  keyframeImageModel?: string
  longVideoAttempted?: boolean
  longVideoAttemptSource?: LongVideoAttemptSource
  nicheDefinitions?: string
  numActorAsset?: number
  numActorAssetsGenerated?: number
  numAssets?: number
  numAssetsGenerated?: number
  numLogoAsset?: number
  numLogoAssetsGenerated?: number
  numObjectAsset?: number
  numObjectAssetsGenerated?: number
  promptRoute?: LongTakePromptRouteForTracking
  promptUseCase?: string
  scriptGeneratorPath?: LongTakeScriptGeneratorPath
  transitionVideoModel?: string
  // Topaz upscale-path outcome for FE-fired tracking (project.downloaded).
  // See UpscaleOutcome: 'success'/'fallback' when the project ran the Topaz
  // upscale path; 'not_run' when it used the non-upscale path.
  upscaleOutcome?: UpscaleOutcome
  useCaseDefinitions?: string
  videoLength?: number
}

type ProjectAttachmentAssetCounts = {
  numActorAsset: number
  numLogoAsset: number
  numObjectAsset: number
}

const LONG_VIDEO_ATTEMPT_SOURCES = new Set<LongVideoAttemptSource>([
  'audio_upload',
  'duration_picker',
  'script_length',
  'uip_duration_option',
  'uip_followup_prompt_duration_mention',
  'uip_initial_prompt_duration_mention',
])

export function buildFasterTtsSurveyMetadata(
  meta: Record<string, number | string> | undefined,
): Pick<
  ProjectMetadataResponse,
  | 'fasterTtsApplied'
  | 'fasterTtsEvaluated'
  | 'fasterTtsPostWpm'
  | 'fasterTtsPreWpm'
  | 'fasterTtsRatio'
  | 'fasterTtsSkipReason'
  | 'fasterTtsStatus'
  | 'fasterTtsTargetWpm'
  | 'fasterTtsWasCapped'
> {
  return {
    fasterTtsApplied: metaBoolean(meta?.fasterTtsApplied),
    fasterTtsEvaluated: metaBoolean(meta?.fasterTtsEvaluated),
    fasterTtsPostWpm: metaNumber(meta?.fasterTtsPostWpm),
    fasterTtsPreWpm: metaNumber(meta?.fasterTtsPreWpm),
    fasterTtsRatio: metaNumber(meta?.fasterTtsRatio),
    fasterTtsSkipReason: metaString(meta?.fasterTtsSkipReason),
    fasterTtsStatus: parseFasterTtsStatus(meta?.fasterTtsStatus),
    fasterTtsTargetWpm: metaNumber(meta?.fasterTtsTargetWpm),
    fasterTtsWasCapped: metaBoolean(meta?.fasterTtsWasCapped),
  }
}

export function buildLongVideoSurveyMetadata(
  meta: Record<string, number | string> | undefined,
  aspectRatioFallback?: null | string,
): Pick<
  ProjectMetadataResponse,
  | 'aspectRatio'
  | 'finalLongVideo'
  | 'longVideoAttempted'
  | 'longVideoAttemptSource'
  | 'promptUseCase'
  | 'videoLength'
> {
  const videoLength = metaNumber(meta?.videoLength)
  const finalLongVideo = videoLength === undefined ? undefined : isLongVideoDuration(videoLength)
  const longVideoAttemptSource = parseLongVideoAttemptSource(meta?.longVideoAttemptSource)
  return {
    aspectRatio: metaString(meta?.aspectRatio) ?? aspectRatioFallback ?? undefined,
    finalLongVideo,
    longVideoAttempted:
      videoLength === undefined && !longVideoAttemptSource
        ? undefined
        : Boolean(longVideoAttemptSource) || finalLongVideo,
    longVideoAttemptSource,
    promptUseCase: metaString(meta?.promptUseCase),
    videoLength,
  }
}

export function countProjectAttachmentAssets(
  attachments: Array<{ name?: null | string }>,
): ProjectAttachmentAssetCounts {
  let numActorAsset = 0
  let numLogoAsset = 0
  let numObjectAsset = 0
  for (const attachment of attachments) {
    const name = (attachment.name || '').toLowerCase()
    if (name.startsWith('actor image')) {
      numActorAsset++
    } else if (name.startsWith('logo image')) {
      numLogoAsset++
    } else if (name.startsWith('object image')) {
      numObjectAsset++
    }
  }
  return { numActorAsset, numLogoAsset, numObjectAsset }
}

/**
 * isBrandVideo for a project = brand_extraction_input != null on its UIP session,
 * matching the definition the BE tracking events use (uipVideoStarted etc.). Lets
 * FE-fired events (project.downloaded, survey.story_mode.submitted) read the same
 * flag via /metadata. Non-UIP projects have no session row -> false.
 */
export async function deriveProjectIsBrandVideo(
  prisma: PrismaService,
  projectId: string,
): Promise<boolean> {
  const uipSession = await prisma.uipSession
    .findUnique({ where: { projectId }, select: { timeline: true } })
    .catch(() => null)
  return uipSession?.timeline
    ? deriveBrandTelemetry(normalizeTimeline(uipSession.timeline)).isBrandVideo
    : false
}

export async function getProjectMetadata(
  projectId: string,
  prisma?: PrismaService,
): Promise<ProjectMetadataResponse> {
  const result: ProjectMetadataResponse = {}

  // Brand-video flag for FE-fired tracking (project.downloaded,
  // survey.story_mode.submitted). Derived from the UIP session so it matches
  // the BE events; skipped when no prisma client is supplied.
  if (prisma) {
    result.isBrandVideo = await deriveProjectIsBrandVideo(prisma, projectId)
  }

  // Topaz upscale-path outcome for FE-fired tracking (project.downloaded), so
  // the upscale ramp's download impact can be compared against the
  // non-upscale path. The trace is written solely by the upscale path, so only
  // a genuinely ABSENT trace (404/ENOENT on the read) means the non-upscale
  // path ('not_run'). A present trace contributes its outcome only when it is a
  // valid value; a missing/malformed outcome, an unreadable/corrupt trace, a
  // transient/auth storage error, or a createStorage failure must NOT be
  // reclassified as non-upscale (that would skew the cohort) -- those leave
  // upscaleOutcome unset (property omitted). We read the object directly and
  // inspect the error rather than using exists()/readOptionalJsonFile, both of
  // which collapse transient failures into "missing".
  try {
    const storage = await createStorage(projectId)
    try {
      const upscaleTrace = await storage.readJsonFile<{ outcome?: unknown }>(
        LONG_TAKE_UPSCALE_TRACE_PATH,
      )
      // Present: the file existing already proves the upscale path ran, so this
      // is never 'not_run'. Track the outcome only if it is a valid value;
      // otherwise omit (do not guess).
      result.upscaleOutcome = toUpscaleOutcome(upscaleTrace?.outcome)
    } catch (readError) {
      if (isMissingStorageObjectError(readError)) {
        result.upscaleOutcome = 'not_run'
      } else {
        throw readError
      }
    }
  } catch (error) {
    logger.warn(
      { error: ensureError(error), projectId },
      'Failed to read upscale trace for project metadata',
    )
  }

  // Calculate shot statistics from shot_best_plan.json files
  // This is independent of niche metadata, so failures shouldn't prevent niche data retrieval
  try {
    const storage = await createStorage(projectId)
    const stats = await calculateShotStatisticsFromBestPlans(storage, projectId)
    Object.assign(result, stats)
  } catch (error) {
    logger.warn(
      { error: ensureError(error), projectId },
      'Failed to calculate shot statistics from shot_best_plan.json files',
    )
  }

  // Read niche metadata from project storage (saved during project creation)
  // Field names match project.v2.created event: 'niche' and 'nicheUseCase'
  // This is independent of shot statistics, so failures shouldn't prevent statistics retrieval
  try {
    const storage = await createStorage(projectId)
    const nicheMetadata = await storage.readJsonFile<{
      confidence?: number
      niche?: string
      nicheUseCase?: string
      rationale?: string[]
    }>('niche_metadata.json')
    logger.info({ projectId, nicheMetadata }, 'Read niche metadata from project storage')
    if (nicheMetadata) {
      result.nicheDefinitions = nicheMetadata.niche
      result.useCaseDefinitions = nicheMetadata.nicheUseCase
      logger.info(
        {
          projectId,
          nicheDefinitions: result.nicheDefinitions,
          useCaseDefinitions: result.useCaseDefinitions,
        },
        'Extracted niche and useCase definitions',
      )
    } else {
      logger.warn({ projectId }, 'Niche metadata file exists but is empty')
    }
  } catch (nicheError) {
    logger.warn(
      { error: ensureError(nicheError), projectId },
      'Niche metadata not found in project storage (may be V1 project or not yet saved)',
    )
  }

  return result
}

export function parseLongTakePromptRoute(
  value: unknown,
): LongTakePromptRouteForTracking | undefined {
  return typeof value === 'string' &&
    LONG_TAKE_PROMPT_ROUTES.has(value as LongTakePromptRouteForTracking)
    ? (value as LongTakePromptRouteForTracking)
    : undefined
}

export function parseScriptGeneratorPath(value: unknown): LongTakeScriptGeneratorPath | undefined {
  return typeof value === 'string' &&
    SCRIPT_GENERATOR_PATHS.has(value as LongTakeScriptGeneratorPath)
    ? (value as LongTakeScriptGeneratorPath)
    : undefined
}

// A genuinely missing object: storage `download()` throws an ApiError with numeric
// code 404; a filesystem-backed read (local cache) throws ENOENT. Anything
// else (auth/transient/corrupt) is NOT "missing".
function isMissingStorageObjectError(error: unknown): boolean {
  const code = (error as null | { code?: number | string })?.code
  return code === 404 || code === '404' || code === 'ENOENT'
}

const VALID_UPSCALE_OUTCOMES: ReadonlySet<string> = new Set<UpscaleOutcome>([
  'fallback',
  'not_run',
  'success',
])

// Runtime-validate a parsed trace outcome: readJsonFile returns unknown JSON, so
// a schema-corrupt value (e.g. { outcome: 'failed' }) must be rejected rather
// than tracked verbatim and fragmenting the cohorts.
function metaBoolean(value: number | string | undefined): boolean | undefined {
  if (typeof value === 'number') {
    return value === 1 ? true : value === 0 ? false : undefined
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') {
    return true
  }
  if (normalized === 'false' || normalized === '0') {
    return false
  }
  return undefined
}

function metaNumber(value: number | string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function metaString(value: number | string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function parseFasterTtsStatus(
  value: number | string | undefined,
): 'applied' | 'not_evaluated' | 'skipped' | undefined {
  return value === 'applied' || value === 'not_evaluated' || value === 'skipped' ? value : undefined
}

function parseLongVideoAttemptSource(
  value: number | string | undefined,
): LongVideoAttemptSource | undefined {
  return typeof value === 'string' &&
    LONG_VIDEO_ATTEMPT_SOURCES.has(value as LongVideoAttemptSource)
    ? (value as LongVideoAttemptSource)
    : undefined
}

function toUpscaleOutcome(value: unknown): undefined | UpscaleOutcome {
  return typeof value === 'string' && VALID_UPSCALE_OUTCOMES.has(value)
    ? (value as UpscaleOutcome)
    : undefined
}

// ---------- enhancePrompt (extracted from ProjectService) ----------

export async function enhancePrompt(userPrompt: string): Promise<string> {
  logger.info(`Enhancing prompt: ${userPrompt.slice(0, 100)}...`)

  try {
    const result = await completion({
      responseFormat: z.string(),
      task: 'enhance-user-prompt',
      models: ['gpt-5', 'gpt-4o-mini', 'gemini-2.5-flash'],
      systemPrompt: enhancerSystemPrompt({}),
      prompt: userPrompt,
      temperature: 0.7,
    })

    const enhancedPrompt = typeof result === 'string' ? result : String(result)

    logger.info('Enhanced prompt generated successfully')
    return enhancedPrompt
  } catch (error) {
    logger.error(`Failed to enhance prompt: ${ensureError(error).message}`)
    // Return original prompt if enhancement fails
    return userPrompt
  }
}

// ---------- generateProjectName (extracted from ProjectService) ----------

/**
 * Longest project name we derive from a script, in UTF-16 code units.
 * Must stay well under the 100-code-unit ceiling that renameProject enforces
 * and the project-card input caps with maxLength, so a generated name is always
 * one the user can edit and save back.
 */
const PROJECT_NAME_MAX_CODE_UNITS = 80
/** Shortest first sentence worth using verbatim as the name. */
const PROJECT_NAME_MIN_SENTENCE_CODE_UNITS = 30

export async function generateProjectName(text?: null | string, useLLM?: boolean): Promise<string> {
  if (!text) {
    return 'New Project'
  }

  if (useLLM) {
    if (text.length <= PROJECT_NAME_MAX_CODE_UNITS) {
      return text
    }

    try {
      const promptTemplate = `You are a YouTube content creator with a deep understanding of user psychology, skilled at attracting viewers with concise and impactful titles.  Each of your videos consistently receives over 100k views.
Now, based on the article I provide, you need to generate only one title with the greatest potential to go viral, one that will make viewers want to click immediately.
Please pay attention to keeping title and article's option perfect match.The original meaning of the article must not be altered in any way.
 Output format:
- Each title ≤ 15 words,without emoji
- Titles must be clear, concise, and engaging, without personal option
- Capture the core idea and user value of the script

Article:
{{scriptText}}`

      const prompt = renderPrompt(promptTemplate, { scriptText: text })
      const generatedName = await genMessage(prompt, 'generate-project-name', 'flash')

      if (generatedName && generatedName.trim().length > 0) {
        return generatedName
      }
    } catch (error) {
      logger.error(
        { error: ensureError(error), text: text.slice(0, 100) },
        'Failed to generate project name with LLM, falling back to rule-based generation',
      )
    }
  }

  const dotIndex = text.indexOf('.')
  if (dotIndex !== -1) {
    // Safe to slice on the dot index: '.' is a BMP character, so the cut can
    // never land inside a surrogate pair.
    const firstSentence = text.slice(0, dotIndex)
    if (
      firstSentence.length >= PROJECT_NAME_MIN_SENTENCE_CODE_UNITS &&
      firstSentence.length <= PROJECT_NAME_MAX_CODE_UNITS
    ) {
      return firstSentence
    }
  }
  if (text.length <= PROJECT_NAME_MAX_CODE_UNITS) {
    return text
  }
  // A bare slice here can end on a lone high surrogate when the cut lands
  // inside an emoji, which Prisma rejects when it writes Project.name.
  return `${truncateWithoutSplittingSurrogates(text, PROJECT_NAME_MAX_CODE_UNITS)}...`
}

// ---------- generateProjectId (extracted from ProjectService) ----------

export function generateProjectId(): string {
  const d = new Date()
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const hour = d.getHours().toString().padStart(2, '0')
  const minute = d.getMinutes().toString().padStart(2, '0')
  const random = Math.random().toString(36).slice(2, 5)
  return `${month}${day}${hour}${minute}-${random}`
}

// ---------- generateVideoDownloadUrl (extracted from ProjectService) ----------

type ProjectDownloadVideo = {
  name: null | string
  resultVideo: null | string
  watermarkVideo: null | string
}

export async function applyNoLipSyncDownloadVariant(
  projectId: string,
  project: ProjectDownloadVideo,
): Promise<ProjectDownloadVideo> {
  const variants = await readLipSyncVideoVariants(projectId)
  const deliveredIsLipSync =
    !!variants?.lipSyncVideoUrl && variants.lipSyncVideoUrl === project.resultVideo
  // Without lip-sync (or after a re-render replaced it), the delivered video
  // already is the non-lip-sync cut.
  if (!deliveredIsLipSync) {
    return project
  }
  if (!variants?.baseVideoUrl) {
    throw new NotFoundException('No non-lip-sync download variant available')
  }
  return {
    ...project,
    resultVideo: variants.baseVideoUrl,
    watermarkVideo: variants.baseWatermarkVideoUrl ?? variants.baseVideoUrl,
  }
}

export function generateVideoDownloadUrl(
  project: ProjectDownloadVideo,
  projectId: string,
  watermark: boolean,
): { filename: string; url: string } {
  // The client fetches the stored video as a blob and saves it locally under `filename`.
  const videoUrl = watermark ? (project.watermarkVideo ?? project.resultVideo) : project.resultVideo
  if (!videoUrl) {
    throw new NotFoundException('Video not available')
  }

  const safeName = sanitizeFilename(project.name ?? projectId)
  const filename = watermark ? `${safeName}-watermark.mp4` : `${safeName}.mp4`

  return { filename, url: videoUrl }
}

async function readLipSyncVideoVariants(
  projectId: string,
): Promise<LongTakeLipSyncVideoVariants | null> {
  try {
    const storage = await createStorage(projectId)
    return await storage.readJsonFile<LongTakeLipSyncVideoVariants>(
      LONG_TAKE_LIP_SYNC_VIDEO_VARIANTS_PATH,
    )
  } catch {
    // No variants file: the project never had a lip-sync cut.
    return null
  }
}

/**
 * Key a download url to the generation of the object it names. The delivered video is
 * rewritten in place at the same path (BGM re-mux, editor re-render), so a browser or proxy
 * cache still holding a previous generation could serve it stale. A per-generation `v` gives
 * each rewrite its own cache entry.
 *
 * Only https urls are keyed: a store:// value's query would be read as part of the object name.
 * Anything unresolvable keeps the unversioned url.
 */
export async function versionDownloadUrlByGeneration(url: string): Promise<string> {
  if (!url.startsWith('https://')) {
    return url
  }
  // One catch for both calls: toStoreUri throws on an unparsable url, and
  // storedFileVersion decodes the uri outside its own try. Either must degrade to the
  // unversioned url rather than fail the download.
  try {
    const fileUri = toStoreUri(url)
    const generation = fileUri ? await storedFileVersion(fileUri) : null
    return generation ? `${url}${url.includes('?') ? '&' : '?'}v=${generation}` : url
  } catch {
    return url
  }
}

// Resolve a project by its share id (the GET /:id + x-reelmakeeasy-shared-id path). Extracted from
// ProjectService to keep that file under the max-lines budget.
export async function getProjectWithShareId(
  prisma: PrismaService,
  projectId: string,
  shareId: string,
): Promise<null | ProjectForBackend> {
  if (!shareId) {
    return null
  }
  const shareItem = await prisma.projectShared.findUnique({
    where: { sharedProjectId: shareId },
  })
  if (!shareItem) {
    return null
  }
  if (shareItem.projectId !== projectId) {
    throw new NotFoundException('Project not found')
  }
  const project = (await prisma.project.findUnique({
    where: { id: projectId },
  })) as null | ProjectForBackend
  return project
}

/**
 * Best-effort first-party download signal for discovery. Recorded only after a valid
 * signed URL; a write failure must never block the download.
 */
export async function recordProjectDownloadEvent(
  prisma: PrismaService,
  projectId: string,
  userId: null | string,
  watermark: boolean,
): Promise<void> {
  try {
    await prisma.projectDownloadEvent.create({ data: { projectId, userId, watermark } })
  } catch (error) {
    logger.warn(`Failed to record ProjectDownloadEvent for ${projectId}: ${error}`)
  }
}
