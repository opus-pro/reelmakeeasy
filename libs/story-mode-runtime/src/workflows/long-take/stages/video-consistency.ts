import type { PipelineContextEntry } from '@reelmakeeasy/common/job-context'
import type { CameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import type { GenerationResolution } from '@reelmakeeasy/common/media/types'

import { LONG_TAKE_BEAT_SHEET_PATH } from '../../../activities/long-take-experts-analysis'
import type { LongTakePromptRoute } from '../../../long-take-prompt-router'
import {
  analyzeLongTakeUserAssets,
  analyzeLongTakeUserAssetUnderstanding,
  finalizeLongTakeAnchorAssets,
  generateLongTakeAnchorAssetFileBinding,
  generateLongTakeExpertsAssetManager,
  generateLongTakeExpertsParallel,
  generateLongTakeSingleRawAnchorAsset,
} from '../activity-proxies'
import type {
  AnalyzeLongTakeUserAssetsActivityResult,
  AnalyzeLongTakeUserAssetUnderstandingActivityResult,
  LongTakeRawAnchorAssetItem,
  LongTakeStyledAnchorAssetItem,
  LongTakeUserAssetCatalogItem,
} from '../types'
import type { LongTakeWorkflowLogFn, LongTakeWorkflowRuntime } from '../workflow-runtime'
import { mapWithConcurrency } from '../workflow-utils'

export type GeneratedAnchorCounts = {
  numActorAssetsGenerated: number
  numAssetsGenerated: number
  numLogoAssetsGenerated: number
  numObjectAssetsGenerated: number
  /**
   * Anchors whose source files matched no actor/logo/object filename
   * prefix (purely planner-generated, or sourced from non-prefixed
   * uploads like UIP refinement drag-drop). Mutually exclusive with
   * the three categorical buckets.
   */
  numOtherAssetsGenerated: number
}

export type UserAssetPreStageResult = {
  userAssetsAnalysisResult: AnalyzeLongTakeUserAssetsActivityResult
  userAssetUnderstandingResult: AnalyzeLongTakeUserAssetUnderstandingActivityResult
}

type AnchorCategory = 'actor' | 'logo' | 'object'

export async function runAnchorAssetsStage(params: {
  // Brand anchor-library key for a saved-brand session; combined with
  // orgId it locates the durable store for reuse. brandStagedAssetIds is the
  // store's allowlist (which generated anchors may enter the org-shared library).
  // Absent on non-brand / classic sessions -> the render-side store/reuse is a no-op.
  brandAnchorLibrary?: {
    brandStagedAssetIds: string[]
    briefId: string
    styleHash: string
    styleName?: null | string
  }
  generationResolution?: GenerationResolution
  imageConcurrency: number
  imageModel?: string
  logInfo: LongTakeWorkflowLogFn
  orgId?: string
  projectId: string
  runtime: LongTakeWorkflowRuntime
  styleText?: string
  userAssetCatalog?: LongTakeUserAssetCatalogItem[]
  userId: string
}): Promise<GeneratedAnchorCounts> {
  const {
    brandAnchorLibrary,
    generationResolution,
    imageConcurrency,
    imageModel,
    logInfo,
    orgId,
    projectId,
    runtime,
    styleText,
    userAssetCatalog,
    userId,
  } = params

  // Only a saved-brand session with a resolvable org key can store/reuse.
  const brandAnchorLibraryKey =
    brandAnchorLibrary && orgId
      ? {
          briefId: brandAnchorLibrary.briefId,
          brandStagedAssetIds: brandAnchorLibrary.brandStagedAssetIds,
          orgId,
          styleHash: brandAnchorLibrary.styleHash,
        }
      : undefined

  await runtime.setStageInProgress({ stage: 'anchor_assets' })
  const anchorTasksResult = await generateLongTakeAnchorAssetFileBinding({
    brandAnchorLibrary: brandAnchorLibraryKey,
    projectId,
    userId,
  })

  // One-shot path: style is baked into the asset manager prompt and image gen prompt
  const rawAnchors = await mapWithConcurrency(
    anchorTasksResult.assetTasks,
    imageConcurrency,
    (assetTask) =>
      generateLongTakeSingleRawAnchorAsset({
        assetTask,
        generationResolution,
        imageModel,
        orgId,
        projectId,
        styleText,
        userId,
      }),
  )
  const styledAnchors: LongTakeStyledAnchorAssetItem[] = rawAnchors.map((raw) => ({
    ...raw,
    effective_anchor_uri: raw.anchor_uri,
    raw_anchor_uri: raw.anchor_uri,
    status: raw.status === 'success' ? ('raw_only' as const) : ('failed' as const),
    styled_anchor_uri: null,
  }))

  const anchorAssetsResult = await finalizeLongTakeAnchorAssets({
    assetCount: anchorTasksResult.assetCount,
    brandAnchorLibrary: brandAnchorLibraryKey,
    projectId,
    rawAnchors,
    styledAnchors,
    userId,
  })
  const generatedCounts = countGeneratedAnchorsByUserCategory(rawAnchors, userAssetCatalog || [])
  await runtime.setStageCompleted({
    meta: {
      assetCount: anchorAssetsResult.assetCount,
      fallbackToRawCount: anchorAssetsResult.fallbackToRawCount,
      numActorAssetsGenerated: generatedCounts.numActorAssetsGenerated,
      numAssetsGenerated: generatedCounts.numAssetsGenerated,
      numLogoAssetsGenerated: generatedCounts.numLogoAssetsGenerated,
      numObjectAssetsGenerated: generatedCounts.numObjectAssetsGenerated,
      rawAnchorCount: anchorAssetsResult.rawAnchorCount,
      styledAnchorCount: anchorAssetsResult.styledAnchorCount,
      userFileBoundAssetCount: anchorTasksResult.userFileBoundAssetCount,
    },
    stage: 'anchor_assets',
  })
  logInfo('longTakeWorkflow anchor assets generated', {
    assetCount: anchorAssetsResult.assetCount,
    fallbackToRawCount: anchorAssetsResult.fallbackToRawCount,
    numActorAssetsGenerated: generatedCounts.numActorAssetsGenerated,
    numAssetsGenerated: generatedCounts.numAssetsGenerated,
    numLogoAssetsGenerated: generatedCounts.numLogoAssetsGenerated,
    numObjectAssetsGenerated: generatedCounts.numObjectAssetsGenerated,
    outputDir: anchorAssetsResult.outputDir,
    rawAnchorCount: anchorAssetsResult.rawAnchorCount,
    styledAnchorCount: anchorAssetsResult.styledAnchorCount,
    userFileBoundAssetCount: anchorTasksResult.userFileBoundAssetCount,
  })
  return generatedCounts
}

export async function runUserAssetPreStage(params: {
  logInfo: LongTakeWorkflowLogFn
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  runtime: LongTakeWorkflowRuntime
  script: string
  userAssetCatalog?: LongTakeUserAssetCatalogItem[]
  userId: string
  userPrompt: string
}): Promise<UserAssetPreStageResult> {
  const {
    logInfo,
    pipelineContext,
    projectId,
    runtime,
    script,
    userAssetCatalog,
    userId,
    userPrompt,
  } = params

  const resolvedUserAssetCatalog = userAssetCatalog || []

  await runtime.setStageInProgress({ stage: 'user_assets_understanding' })
  const userAssetUnderstandingResult = await analyzeLongTakeUserAssetUnderstanding({
    pipelineContext,
    projectId,
    userAssetCatalog: resolvedUserAssetCatalog,
    userId,
  })
  await runtime.setStageCompleted({
    meta: {
      analyzed: userAssetUnderstandingResult.analyzedCount,
      failed: userAssetUnderstandingResult.failedCount,
    },
    stage: 'user_assets_understanding',
  })
  logInfo('longTakeWorkflow user assets understood', {
    analyzed: userAssetUnderstandingResult.analyzedCount,
    failed: userAssetUnderstandingResult.failedCount,
    outputPath: userAssetUnderstandingResult.outputPath,
  })

  await runtime.setStageInProgress({ stage: 'user_assets_analysis' })
  const userAssetsAnalysisResult = await analyzeLongTakeUserAssets({
    pipelineContext,
    projectId,
    script,
    userAssetCatalog: resolvedUserAssetCatalog,
    userId,
    userPrompt,
  })
  await runtime.setStageCompleted({
    meta: {
      fileCount: userAssetsAnalysisResult.fileCount,
      matched: userAssetsAnalysisResult.matchedCount,
      unresolved: userAssetsAnalysisResult.unresolvedCount,
    },
    stage: 'user_assets_analysis',
  })
  logInfo('longTakeWorkflow user assets analyzed', {
    analysisPath: userAssetsAnalysisResult.outputPath,
    fileCount: userAssetsAnalysisResult.fileCount,
    matched: userAssetsAnalysisResult.matchedCount,
    unresolved: userAssetsAnalysisResult.unresolvedCount,
  })

  return { userAssetUnderstandingResult, userAssetsAnalysisResult }
}

export async function runVideoConsistencyStages(params: {
  // Brand anchor-library key, threaded to the anchor stage for
  // render-side store + reuse. Absent on non-brand / classic sessions.
  brandAnchorLibrary?: {
    brandStagedAssetIds: string[]
    briefId: string
    styleHash: string
    styleName?: null | string
  }
  cameraStyle?: CameraStyle
  generationResolution?: GenerationResolution
  imageConcurrency: number
  imageModel?: string
  logInfo: LongTakeWorkflowLogFn
  // Music-video route: the music-driven beat sheet was already built + persisted by the workflow
  // (analyzeMusicBeatGrid -> buildLongTakeMusicBeatSheet). When skipTextBeatSheet is set, the experts
  // step skips its text-driven beat sheet; musicBeatCount is only for logging.
  musicBeatCount?: number
  orgId?: string
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  runtime: LongTakeWorkflowRuntime
  script: string
  skipTextBeatSheet?: boolean
  styleText?: string
  transitionVideoModel?: string
  userAssetCatalog?: LongTakeUserAssetCatalogItem[]
  userAssetPreStageResult?: null | UserAssetPreStageResult
  userEmail?: string
  userId: string
  userPrompt: string
}): Promise<GeneratedAnchorCounts> {
  const {
    brandAnchorLibrary,
    cameraStyle,
    generationResolution,
    imageConcurrency,
    imageModel,
    logInfo,
    musicBeatCount,
    orgId,
    pipelineContext,
    promptRoute,
    projectId,
    runtime,
    script,
    skipTextBeatSheet,
    styleText,
    transitionVideoModel,
    userAssetCatalog,
    userEmail,
    userId,
    userPrompt,
    userAssetPreStageResult,
  } = params

  // User asset understanding + analysis may have been pre-computed in parallel with voiceover
  if (!userAssetPreStageResult) {
    const resolvedUserAssetCatalog = userAssetCatalog || []

    await runtime.setStageInProgress({ stage: 'user_assets_understanding' })
    const userAssetUnderstandingResult = await analyzeLongTakeUserAssetUnderstanding({
      pipelineContext,
      projectId,
      userAssetCatalog: resolvedUserAssetCatalog,
      userId,
    })
    await runtime.setStageCompleted({
      meta: {
        analyzed: userAssetUnderstandingResult.analyzedCount,
        failed: userAssetUnderstandingResult.failedCount,
      },
      stage: 'user_assets_understanding',
    })
    logInfo('longTakeWorkflow user assets understood', {
      analyzed: userAssetUnderstandingResult.analyzedCount,
      failed: userAssetUnderstandingResult.failedCount,
      outputPath: userAssetUnderstandingResult.outputPath,
    })

    await runtime.setStageInProgress({ stage: 'user_assets_analysis' })
    const userAssetsAnalysisResult = await analyzeLongTakeUserAssets({
      pipelineContext,
      projectId,
      script,
      userAssetCatalog: resolvedUserAssetCatalog,
      userId,
      userPrompt,
    })
    await runtime.setStageCompleted({
      meta: {
        fileCount: userAssetsAnalysisResult.fileCount,
        matched: userAssetsAnalysisResult.matchedCount,
        unresolved: userAssetsAnalysisResult.unresolvedCount,
      },
      stage: 'user_assets_analysis',
    })
    logInfo('longTakeWorkflow user assets analyzed', {
      analysisPath: userAssetsAnalysisResult.outputPath,
      fileCount: userAssetsAnalysisResult.fileCount,
      matched: userAssetsAnalysisResult.matchedCount,
      unresolved: userAssetsAnalysisResult.unresolvedCount,
    })
  }

  await runExpertsAnalysisStage({
    cameraStyle,
    logInfo,
    musicBeatCount,
    pipelineContext,
    promptRoute,
    projectId,
    runtime,
    script,
    skipTextBeatSheet,
    styleText,
    transitionVideoModel,
    userEmail,
    userId,
  })

  return runAnchorAssetsStage({
    brandAnchorLibrary,
    generationResolution,
    imageModel,
    imageConcurrency,
    logInfo,
    orgId,
    projectId,
    runtime,
    styleText,
    userAssetCatalog,
    userId,
  })
}

function countGeneratedAnchorsByUserCategory(
  rawAnchors: LongTakeRawAnchorAssetItem[],
  userAssetCatalog: LongTakeUserAssetCatalogItem[],
): GeneratedAnchorCounts {
  const fileIdToCategory = new Map<string, AnchorCategory>()
  for (const item of userAssetCatalog) {
    const category = shortnameToAnchorCategory(item.shortname)
    if (category) {
      fileIdToCategory.set(item.fileId, category)
    }
  }

  let actor = 0
  let logo = 0
  let object = 0
  let other = 0
  let total = 0
  for (const anchor of rawAnchors) {
    if (!anchor.anchor_uri) {
      continue
    }
    total++
    const categories = new Set<AnchorCategory>()
    for (const fileId of anchor.source_file_ids) {
      const category = fileIdToCategory.get(fileId)
      if (category) {
        categories.add(category)
      }
    }
    actor += categories.has('actor') ? 1 : 0
    logo += categories.has('logo') ? 1 : 0
    object += categories.has('object') ? 1 : 0
    other += categories.size === 0 ? 1 : 0
  }

  // Multi-category anchors bump multiple buckets, so the four-way sum
  // can exceed `total`. `total` stays the distinct-anchor count for
  // backward compatibility.
  return {
    numActorAssetsGenerated: actor,
    numAssetsGenerated: total,
    numLogoAssetsGenerated: logo,
    numObjectAssetsGenerated: object,
    numOtherAssetsGenerated: other,
  }
}

async function runExpertsAnalysisStage(params: {
  cameraStyle?: CameraStyle
  logInfo: LongTakeWorkflowLogFn
  musicBeatCount?: number
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  runtime: LongTakeWorkflowRuntime
  script: string
  skipTextBeatSheet?: boolean
  styleText?: string
  transitionVideoModel?: string
  userEmail?: string
  userId: string
}): Promise<void> {
  const {
    cameraStyle,
    logInfo,
    musicBeatCount,
    pipelineContext,
    projectId,
    promptRoute,
    runtime,
    script,
    skipTextBeatSheet,
    styleText,
    transitionVideoModel,
    userEmail,
    userId,
  } = params
  const transcriptPath = 'story_loader/transcript/transformed_transcript.json'
  await runtime.setStageInProgress({ stage: 'experts_analysis' })

  // Music-video route: the music-driven beat sheet was already built + persisted to the standard path
  // by the workflow (analyzeMusicBeatGrid -> buildLongTakeMusicBeatSheet), so the experts step skips
  // its text-driven beat sheet and only produces world bible + asset manifest.
  const {
    beatSheet: textBeatSheetResult,
    worldBible: worldBibleResult,
    assetManifest: assetManifestResult,
  } = await generateLongTakeExpertsParallel({
    cameraStyle,
    pipelineContext,
    promptRoute,
    projectId,
    script,
    skipBeatSheet: skipTextBeatSheet,
    styleText,
    transitionVideoModel,
    transcriptPath,
    userEmail,
    userId,
  })

  const beatSheetResult = skipTextBeatSheet
    ? {
        beatCount: musicBeatCount ?? 0,
        outputPath: LONG_TAKE_BEAT_SHEET_PATH,
        textAudited: false,
        timeAudited: true,
        usedFallback: false,
      }
    : textBeatSheetResult
  const assetManagerResult = await generateLongTakeExpertsAssetManager({
    pipelineContext,
    promptRoute,
    projectId,
    styleText,
    userId,
  })
  // Accumulate expert summaries into pipeline context
  if (pipelineContext && worldBibleResult.contextSummary) {
    pipelineContext.push({ name: 'World Bible', value: worldBibleResult.contextSummary })
  }

  const expertsFallbackCount =
    Number(beatSheetResult.usedFallback) +
    Number(worldBibleResult.usedFallback) +
    Number(assetManifestResult.usedFallback) +
    Number(assetManagerResult.usedFallback)
  await runtime.setStageCompleted({
    meta: {
      beatCount: beatSheetResult.beatCount,
      fallbackCount: expertsFallbackCount,
      manifestCount: assetManifestResult.manifestCount,
      promptCount: assetManagerResult.promptCount,
    },
    stage: 'experts_analysis',
  })
  logInfo('longTakeWorkflow experts analyzed', {
    beatCount: beatSheetResult.beatCount,
    beatSheetTextAudited: beatSheetResult.textAudited,
    beatSheetTimeAudited: beatSheetResult.timeAudited,
    fallbackCount: expertsFallbackCount,
    manifestCount: assetManifestResult.manifestCount,
    outputPaths: {
      assetManager: assetManagerResult.outputPath,
      assetManifest: assetManifestResult.outputPath,
      beatSheet: beatSheetResult.outputPath,
      worldBible: worldBibleResult.outputPath,
    },
    promptCount: assetManagerResult.promptCount,
  })
}

function shortnameToAnchorCategory(shortname: string): AnchorCategory | null {
  const name = shortname.toLowerCase()
  if (name.startsWith('actor image')) {
    return 'actor'
  }
  if (name.startsWith('logo image')) {
    return 'logo'
  }
  if (name.startsWith('object image')) {
    return 'object'
  }
  return null
}
