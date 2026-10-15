import {
  type CaptionKind,
  FINAL_VIDEO_CAPTION_STYLE_PATH,
  readRenderedCaptionStyle,
} from '@reelmakeeasy/common/adapters/caption/caption-look'
import { readCaptionStyleSettings } from '@reelmakeeasy/common/adapters/caption/caption-style'
import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import type { KvStore } from '@reelmakeeasy/common/kv/store'
import type { Logger } from '@reelmakeeasy/common/logger'
import { getLongTakeRequestKey, getLongTakeStatusKey } from '@reelmakeeasy/common/long-take'
import { LONG_TAKE_LIP_SYNC_VIDEO_VARIANTS_PATH } from '@reelmakeeasy/common/long-take/lip-sync-variants'
import { getLongTakeAdmissionPayload } from '@reelmakeeasy/common/long-take/queue-admission'
import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { workspaceUri } from '@reelmakeeasy/common/storage/stored-files'
import { BEAT_LOOP_USE_CASE } from '@shared/types/api/agent'
import type { CaptionStyleSettings } from '@shared/types/api/caption-style'
import type { LongTakeStatus } from '@shared/types/api/long-take'
import { isStaleInProgressProject, PROJECT_STAGE } from '@shared/types/enums/project'

import {
  normalizeStyleThumbnailUrl,
  pickFirstBoolean,
  pickFirstText,
  readOptionalJsonFile,
} from './long-take-helpers.util'
import { readLoopSfxBedStatus } from './long-take-loop-sfx-bed.util'
import {
  buildQueuedAdmissionMeta,
  resolveUploadedAudioUrl as resolveUploadedAudioUrlUtil,
} from './long-take-workflow.util'

export const STATUS_CACHE_PREFIX = 'long-take:status-cache:'
export const STATUS_CACHE_TTL_SECONDS = 8

// storage-relative paths the long-take render writes (see render-final.ts).
const FINAL_VIDEO_FILE = 'final_video.mp4'
const FINAL_VIDEO_THUMBNAIL = '_thumbnail/final_video.mp4.jpg'
// A loop short's storyboard (BEAT_LOOP_STORYBOARD_PATH): the render draws a loop when it exists.
const BEAT_LOOP_STORYBOARD_FILE = 'long_take/beat_loop.json'

// How long a non-terminal status blob must sit untouched before it counts as
// abandoned and the storage probe is allowed to run for it.
const STALE_NONTERMINAL_RECONCILE_MS = 10 * 60 * 1000

export interface StatusDeps {
  kv: Pick<KvStore, 'getObject' | 'set'>
  logger: Logger
  projectsService: {
    canVisitProject: (projectId: string) => Promise<boolean>
    getProject: (projectId: string) => Promise<null | {
      bgmBedCdnUrl?: null | string
      bgmBedGainDb?: null | number
      bgmBedUri?: null | string
      bgmDuckDb?: null | number
      bgmEnabled?: boolean | null
      bgmModel?: null | string
      bgmSource?: null | string
      bgmTrackId?: null | string
      bgmTrackName?: null | string
      bgmVersions?: null | unknown[]
      bgmVolume?: null | number
      /** Json column: read through readCaptionStyleSettings. */
      captionStyle?: unknown
      createdAt?: Date | null | string
      createUseCase?: null | string
      enableCaption?: boolean | null
      isLongTake?: boolean | null
      longTakeRatio?: null | string
      resultVideo?: null | string
      resultVideoThumbnail?: null | string
      script?: null | string
      stage?: null | string
      styleName?: null | string
      styleText?: null | string
      styleThumbnailUrl?: null | string
      updatedAt?: Date | null
      watermarkVideo?: null | string
    }>
    internalUpdateProject: (
      projectId: string,
      data: {
        previewThumbnail?: string
        resultVideo?: string
        resultVideoThumbnail?: string
        stage?: string
      },
      userId: string,
    ) => Promise<unknown>
  }
}

export async function buildLongTakeStatus(
  deps: StatusDeps,
  projectId: string,
): Promise<LongTakeStatus | null> {
  const cacheKey = `${STATUS_CACHE_PREFIX}${projectId}`
  const cached = await deps.kv.getObject<LongTakeStatus>(cacheKey)
  if (cached) {
    return cached
  }

  const [status, project, requestMetadata, admissionPayload] = await Promise.all([
    deps.kv.getObject<LongTakeStatus>(getLongTakeStatusKey(projectId)),
    deps.projectsService.getProject(projectId),
    deps.kv.getObject<{
      audioPath?: null | string
      customStyle?: boolean | null
      isSavedStyle?: boolean | null
      script?: null | string
      styleName?: null | string
      styleText?: null | string
      styleThumbnailUrl?: null | string
      userPrompt?: null | string
    }>(getLongTakeRequestKey(projectId)),
    getLongTakeAdmissionPayload(deps.kv as KvStore, projectId),
  ])

  let storage: Awaited<ReturnType<typeof createStorage>> | null = null
  try {
    storage = await createStorage(projectId)
  } catch {
    // storage unavailable
  }

  let script: null | string = null
  if (storage) {
    try {
      script = await storage.readTextFile(STORY_LOADER_PATHS.scriptTxtPath)
    } catch {
      // ignore
    }
  }

  if (!script) {
    script = requestMetadata?.script ?? project?.script ?? null
  }

  // Strip @img[...](...)  tags that may leak from user prompts into stored script values.
  if (script) {
    script = script.replace(/@img\[[^\]]*\]\([^)]*\)/g, '').trim() || null
  }

  const uploadedAudioUrl = await resolveUploadedAudioUrlUtil(
    createStorage,
    storeUriToUrl,
    STORY_LOADER_PATHS.audioVoiceoverPath,
    requestMetadata?.audioPath,
    projectId,
    storage,
  )
  const audioPreviewUrl = await resolveLongTakeAudioPreviewUrl(storage)
  const rawLipSyncVideoVariants = storage
    ? await readOptionalJsonFile<LongTakeStatus['lipSyncVideoVariants']>(
        storage,
        LONG_TAKE_LIP_SYNC_VIDEO_VARIANTS_PATH,
      )
    : undefined

  const customStyle = pickFirstBoolean(requestMetadata?.customStyle, status?.customStyle)
  const enableCaption = pickFirstBoolean(project?.enableCaption, status?.enableCaption)
  // The caption look lives on the project only; the status blob never carries it.
  const captionStyle = readCaptionStyleSettings(project?.captionStyle)
  const isSavedStyle = pickFirstBoolean(requestMetadata?.isSavedStyle, status?.isSavedStyle)

  // BGM (Story Mode background music) data contract: the project is
  // the source of truth, with the stored status blob as fallback (mirrors
  // enableCaption). Numbers pass through with ?? so a 0 volume survives.
  // Surfaced UNCONDITIONALLY (no gate at this API boundary; null until generation
  // writes them); FE consumers gate *rendering* on the `enable_bgm` flag.
  // bgmPrompt/bgmVersions stay project-only: the status is readable by share-link
  // viewers, and the playback FE needs neither the LLM prompt text nor the
  // unbounded regen history (the editor backend, will expose them to
  // owners when regeneration ships). bgmRegenerated is the one exception: a
  // derived boolean (versions non-empty; only regenerates write versions) that
  // leaks no prompt/URI content, for project.downloaded tracking.
  const bgmEnabled = pickFirstBoolean(project?.bgmEnabled, status?.bgmEnabled)
  const bgmRegenerated = (project?.bgmVersions?.length ?? 0) > 0
  const bgmBedCdnUrl = pickFirstText(project?.bgmBedCdnUrl, status?.bgmBedCdnUrl)
  const bgmBedGainDb = project?.bgmBedGainDb ?? status?.bgmBedGainDb
  const bgmBedUri = pickFirstText(project?.bgmBedUri, status?.bgmBedUri)
  const bgmModel = pickFirstText(project?.bgmModel, status?.bgmModel)
  const bgmTrackName = pickFirstText(project?.bgmTrackName, status?.bgmTrackName)
  const bgmSource = pickFirstText(project?.bgmSource, status?.bgmSource)
  const bgmTrackId = pickFirstText(project?.bgmTrackId, status?.bgmTrackId)
  const bgmVolume = project?.bgmVolume ?? status?.bgmVolume
  const bgmDuckDb = project?.bgmDuckDb ?? status?.bgmDuckDb
  const styleText = pickFirstText(requestMetadata?.styleText, project?.styleText, status?.styleText)
  const styleName = pickFirstText(requestMetadata?.styleName, project?.styleName, status?.styleName)
  const styleThumbnailUrl = normalizeStyleThumbnailUrl(
    pickFirstText(
      requestMetadata?.styleThumbnailUrl,
      project?.styleThumbnailUrl,
      status?.styleThumbnailUrl,
    ),
  )
  const reconciled = await reconcileResultVideoFromStore(deps, projectId, storage, {
    projectExists: !!project,
    projectIsLongTake: !!project?.isLongTake,
    projectStage: project?.stage ?? undefined,
    statusStage: status?.stage,
    statusUpdatedAt: status?.updatedAt,
    videoUrl: project?.resultVideo || null,
  })
  const videoUrl = reconciled.videoUrl
  // A post-render step can throw AFTER the
  // render already wrote final_video.mp4; the workflow's global catch then
  // overwrites the stored status blob to error/rejected. That blob otherwise wins
  // via `status ?? dbStatus` below, so a produced video would still read as a
  // failure. When the reconciled videoUrl proves the render succeeded, trust it.
  const isLatchedFalseFailure =
    !!videoUrl &&
    (status?.stage === 'error' || status?.stage === 'rejected' || reconciled.staleNonTerminal)
  const lipSyncVideoVariants = currentLipSyncVideoVariants(rawLipSyncVideoVariants, videoUrl)
  const captionLook = await readCaptionLookStatus(storage, {
    createUseCase: project?.createUseCase,
    delivered: !!videoUrl,
  })
  // A loop's clip sound bed for the live preview; one it lacks is built once it is delivered and
  // no render runs.
  const loopSfxBed = await readLoopSfxBedStatus(
    storage,
    {
      kind: captionLook.captionKind,
      projectId,
      settled: !!videoUrl && status?.status !== 'in_progress',
    },
    deps.logger,
  )
  const watermarkVideoUrl = project?.watermarkVideo || null
  const resultVideoThumbnail = project?.resultVideoThumbnail || null
  const queuedMeta =
    status?.stage === 'queued' || (!status && admissionPayload)
      ? await buildQueuedAdmissionMeta({ kv: deps.kv as never }, projectId, admissionPayload)
      : undefined

  if (
    !status &&
    !project?.isLongTake &&
    !script &&
    !styleText &&
    !uploadedAudioUrl &&
    !audioPreviewUrl &&
    !videoUrl
  ) {
    return null
  }

  // stage=FINISHED with no resultVideo means the workflow completed but the video URL
  // was never written (e.g. the project-patch pushChunks call failed). Show error so the
  // user sees a failure state rather than "still generating" indefinitely.
  const statusFromDb = resolveStatusFromDb(videoUrl, project, !!admissionPayload)
  const dbStatus: LongTakeStatus = {
    ...statusFromDb,
    updatedAt: project?.updatedAt
      ? new Date(project.updatedAt).toISOString()
      : new Date().toISOString(),
    ...(queuedMeta ? { meta: queuedMeta } : {}),
  }

  const result = {
    ...(status ?? dbStatus),
    ...(queuedMeta
      ? {
          meta: {
            ...status?.meta,
            ...queuedMeta,
          },
        }
      : {}),
    customStyle,
    enableCaption,
    captionStyle,
    ...captionLook,
    bgmEnabled,
    bgmBedCdnUrl,
    bgmBedGainDb,
    bgmBedUri,
    bgmDuckDb,
    bgmModel,
    bgmRegenerated,
    bgmSource,
    bgmTrackId,
    bgmTrackName,
    bgmVolume,
    isSavedStyle,
    ...(lipSyncVideoVariants ? { lipSyncVideoVariants } : {}),
    ...loopSfxBed,
    resultVideoThumbnail,
    script,
    styleName,
    styleThumbnailUrl,
    styleText,
    audioPreviewUrl,
    uploadedAudioUrl,
    videoUrl,
    watermarkVideoUrl,
    ...(isLatchedFalseFailure
      ? { stage: 'completed' as const, status: 'completed' as const, detail: undefined }
      : {}),
  }

  deps.kv.set(cacheKey, result, STATUS_CACHE_TTL_SECONDS)

  return result
}

function currentLipSyncVideoVariants(
  variants: LongTakeStatus['lipSyncVideoVariants'],
  videoUrl: null | string,
): LongTakeStatus['lipSyncVideoVariants'] {
  if (!variants?.baseVideoUrl || (variants.lipSyncVideoUrl || null) !== (videoUrl || null)) {
    return undefined
  }
  return variants
}

/**
 * The caption fields only the project's folder knows: which default look the video takes (a loop
 * starts in Punch), the colour a loop's storyboard suggests for the highlight (offered, never
 * applied), and the look the delivered file was rendered with (the record its render wrote once
 * the file was uploaded, not the video script, which a later render rewrites before it renders;
 * null before looks were recorded, or with no file). Without the folder, a loop is known by its
 * row.
 */
async function readCaptionLookStatus(
  storage: Awaited<ReturnType<typeof createStorage>> | null,
  current: { createUseCase?: null | string; delivered: boolean },
): Promise<{
  captionAccentSuggestion: null | string
  captionKind: CaptionKind
  renderedCaptionStyle: CaptionStyleSettings | null
}> {
  const [loopFile, record] = storage
    ? await Promise.all([
        readOptionalJsonFile<{ accent?: unknown; storyboard?: { accent?: unknown } }>(
          storage,
          BEAT_LOOP_STORYBOARD_FILE,
        ),
        current.delivered
          ? readOptionalJsonFile<unknown>(storage, FINAL_VIDEO_CAPTION_STYLE_PATH)
          : undefined,
      ])
    : [undefined, undefined]
  // The app keeps the storyboard under `storyboard` (BeatLoopFile); a bare one is read too, as
  // the render reads it (parseBeatLoopRenderSpec).
  const storyboard =
    loopFile?.storyboard && typeof loopFile.storyboard === 'object' ? loopFile.storyboard : loopFile
  const accent = storyboard?.accent
  return {
    captionAccentSuggestion:
      typeof accent === 'string' && /^#[\da-f]{6}$/i.test(accent) ? accent.toUpperCase() : null,
    captionKind: loopFile || current.createUseCase === BEAT_LOOP_USE_CASE ? 'loop' : 'video',
    renderedCaptionStyle: readRenderedCaptionStyle(record),
  }
}

// Reconciliation: the long-take render can finish and upload
// final_video.mp4 to storage while the terminal project-patch (stage=FINISHED +
// resultVideo) fails to persist to the project doc. The render workflow still
// completes (the patch POST 200s) and the stored status flips to 'completed', so
// the FE stops polling but never sees a videoUrl -> permanent "finalizing"
// loader. When the status says completed but resultVideo is missing, probe storage
// for the rendered video and backfill the project so videoUrl resolves now and
// the doc becomes durable. Tightly gated (completed + no videoUrl) so the storage
// probe only runs for genuinely-stuck projects; best-effort so a probe/write
// failure never breaks the status read.
async function reconcileResultVideoFromStore(
  deps: StatusDeps,
  projectId: string,
  storage: Awaited<ReturnType<typeof createStorage>> | null,
  current: {
    projectExists: boolean
    projectIsLongTake: boolean
    projectStage: string | undefined
    statusStage: string | undefined
    statusUpdatedAt: string | undefined
    videoUrl: null | string
  },
): Promise<{ staleNonTerminal: boolean; videoUrl: null | string }> {
  const isTerminalStage =
    current.statusStage === 'completed' ||
    current.statusStage === 'error' ||
    current.statusStage === 'rejected'
  // A post-render activity can throw while the blob still reads a non-terminal
  // stage, latching it there forever. Such a blob is only trusted as abandoned
  // once it has gone untouched past the threshold; 'queued' is excluded because
  // it legitimately sits idle while waiting for admission. The guard against
  // picking up an OLD final_video.mp4 from a stuck regeneration cannot be
  // written here: the storage wrapper reports only a storage generation, and the
  // status blob carries no run start marker to compare it against.
  const isStaleNonTerminal =
    !isTerminalStage &&
    current.statusStage !== 'queued' &&
    !!current.statusUpdatedAt &&
    Date.now() - new Date(current.statusUpdatedAt).getTime() > STALE_NONTERMINAL_RECONCILE_MS
  // The status blob expires (LONG_TAKE_STATUS_TTL_SECONDS) before anyone reads
  // it for an abandoned project, so the DB stage is the only terminal signal
  // left. FAILED or FINISHED without a resultVideo is exactly the latched
  // post-upload throw the two branches above repair while the blob is alive.
  const isExpiredTerminalDb =
    current.statusStage === undefined &&
    current.projectIsLongTake &&
    (current.projectStage === PROJECT_STAGE.FAILED ||
      current.projectStage === PROJECT_STAGE.FINISHED)
  if (
    current.videoUrl ||
    (!isTerminalStage && !isStaleNonTerminal && !isExpiredTerminalDb) ||
    !current.projectExists ||
    !storage
  ) {
    return { staleNonTerminal: false, videoUrl: current.videoUrl }
  }
  try {
    if (!(await storage.exists(FINAL_VIDEO_FILE))) {
      return { staleNonTerminal: false, videoUrl: current.videoUrl }
    }
    // Addresses, as a render saves them: the URLs are built when the project is sent out.
    const resultVideo = workspaceUri(projectId, FINAL_VIDEO_FILE)
    const resultVideoThumbnail = workspaceUri(projectId, FINAL_VIDEO_THUMBNAIL)
    await deps.projectsService.internalUpdateProject(
      projectId,
      {
        previewThumbnail: resultVideoThumbnail,
        resultVideo,
        resultVideoThumbnail,
        stage: PROJECT_STAGE.FINISHED,
      },
      'system',
    )
    return { staleNonTerminal: isStaleNonTerminal, videoUrl: resultVideo }
  } catch (error) {
    deps.logger.warn(
      `[long-take] result-video reconciliation failed ${JSON.stringify({
        projectId,
        error: error instanceof Error ? error.message : String(error),
      })}`,
    )
    return { staleNonTerminal: false, videoUrl: current.videoUrl }
  }
}

async function resolveLongTakeAudioPreviewUrl(
  storage: Awaited<ReturnType<typeof createStorage>> | null,
): Promise<null | string> {
  if (!storage) {
    return null
  }

  const voiceOverM4aPath = STORY_LOADER_PATHS.audioVoiceoverPath.replace(/\.mp3$/i, '.m4a')

  try {
    if (await storage.exists(voiceOverM4aPath)) {
      return storeUriToUrl(storage.getFullPath(voiceOverM4aPath))
    }
  } catch {
    // ignore
  }

  return null
}

function resolveStatusFromDb(
  videoUrl: null | string,
  project: null | { createdAt?: Date | null | string; stage?: null | string },
  hasAdmissionPayload: boolean,
): { stage: LongTakeStatus['stage']; status: LongTakeStatus['status'] } {
  if (videoUrl) {
    return { stage: 'completed', status: 'completed' }
  }
  if (project?.stage === PROJECT_STAGE.FINISHED) {
    return { stage: 'error', status: 'error' }
  }
  // A live admission payload beats the createdAt-based stale verdict below:
  // regenerate/restyle enqueue fresh runs on the SAME project, so an old
  // project can be legitimately queued. The payload is TTL-bound (3 days,
  // deleted on admission), so a dead entry ages out and falls through.
  if (hasAdmissionPayload) {
    return { stage: 'queued', status: 'in_progress' }
  }
  // Past the staleness threshold no writer is left to finish this
  // project, so the fallback resolves to error instead of spinning forever.
  if (project && isStaleInProgressProject({ createdAt: project.createdAt, stage: project.stage })) {
    return { stage: 'error', status: 'error' }
  }
  return { stage: 'started', status: 'in_progress' }
}
