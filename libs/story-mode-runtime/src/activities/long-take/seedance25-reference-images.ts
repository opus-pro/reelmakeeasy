import * as path from 'node:path'

import { isSeedance25Model } from '@reelmakeeasy/common/veo3/model'
import { BYTEDANCE_CAPABILITIES } from '@reelmakeeasy/common/video-models'
import type { ResizeOptions } from 'sharp'
import sharp from 'sharp'

import {
  downloadAssetToLocal,
  formatError,
  formatLogFields,
  logger,
  mapWithConcurrency,
} from './common'
import { type createLongTakeStorage, getLongTakeAnchorLookup } from './storage'

const SEEDANCE25_MAX_REFERENCE_IMAGES = 30
const SEEDANCE25_KEYFRAME_REFERENCE_COUNT = 2

/**
 * Ark's per-image reference-input bounds (300px floor, [0.40, 2.50] aspect
 * envelope). A violation on ANY reference fails the whole create-task call, so
 * every reference is normalized here before it reaches the provider. Required
 * boundary/waypoint frames fail the merged clip if unreadable because prompts
 * refer to them positionally; optional anchors are dropped when unreadable --
 * losing enrichment is better than sending a request that cannot succeed.
 */
const SEEDANCE25_REFERENCE_IMAGE_RULES =
  BYTEDANCE_CAPABILITIES['dreamina-seedance-2-5-260628'].referenceImage

/**
 * Our processing cap, not a provider bound: the padded canvas long side never
 * exceeds this, so an extreme-ratio panorama cannot balloon into a
 * multi-hundred-megapixel PNG inside the activity worker.
 */
const SEEDANCE25_MAX_PADDED_REFERENCE_DIMENSION_PX = 2_048

export interface Seedance25ReferenceImageParams {
  firstFramePath: string
  /**
   * Ordered waypoint keyframes between the merged sub-segments.
   * Placed as @Image3+ directly after the boundary frames so the prompt's
   * positional references stay valid; a download failure here throws instead
   * of dropping, because silently renumbering waypoints would desync every
   * @ImageN reference the workflow already wrote into the prompt.
   */
  intermediateKeyframeUris?: string[]
  /**
   * Absent for a Story Mode 3.0 `cut` clip, generated i2v-only. The
   * destination reference is dropped rather than pointing at an unwritten file.
   */
  lastFramePath?: string
  projectId: string
  referenceAssetIds?: string[]
  storage: ReturnType<typeof createLongTakeStorage>
  tempDir: string
  transitionId: string
  transitionVideoModel: string
}

export interface Seedance25ReferenceImageSet {
  anchorAssetIds: string[]
  /** One-based provider image index of the first surviving anchor reference. */
  anchorStartImageIndex: number
  urls: string[]
}

type NormalizedReferenceImage = {
  path: string
  resized: boolean
}

type Seedance25AnchorReference = {
  assetId: string
  path: string
}

export async function prepareSeedance25ReferenceImageSet(
  params: Seedance25ReferenceImageParams,
): Promise<Seedance25ReferenceImageSet | undefined> {
  if (!isSeedance25Model(params.transitionVideoModel)) {
    return undefined
  }

  const intermediatePaths = await downloadSeedance25IntermediateKeyframes({
    intermediateKeyframeUris: params.intermediateKeyframeUris ?? [],
    tempDir: params.tempDir,
    transitionId: params.transitionId,
  })
  const anchorReferencesToDownload = await resolveSeedance25AnchorReferences({
    ...params,
    // One boundary frame instead of two when the clip is i2v-only, so the freed
    // slot goes to an identity anchor rather than being reserved for nothing.
    reservedReferenceCount:
      (params.lastFramePath ? SEEDANCE25_KEYFRAME_REFERENCE_COUNT : 1) + intermediatePaths.length,
  })
  const downloadedAnchorPaths = await downloadSeedance25AnchorReferences({
    anchors: anchorReferencesToDownload,
    indexOffset: intermediatePaths.length,
    projectId: params.projectId,
    tempDir: params.tempDir,
    transitionId: params.transitionId,
  })
  const keyframeReferences = await normalizeRequiredSeedance25References({
    imagePaths: [params.firstFramePath, params.lastFramePath, ...intermediatePaths].filter(
      (imagePath): imagePath is string => Boolean(imagePath),
    ),
    projectId: params.projectId,
    transitionId: params.transitionId,
  })
  const anchorReferences = await normalizeOptionalSeedance25AnchorReferences({
    anchorPaths: downloadedAnchorPaths,
    projectId: params.projectId,
    transitionId: params.transitionId,
  })
  const referenceImages = [
    ...keyframeReferences.map((reference) => reference.path),
    ...anchorReferences.map((reference) => reference.path),
  ].slice(0, SEEDANCE25_MAX_REFERENCE_IMAGES)
  const resizedReferenceCount =
    keyframeReferences.filter((reference) => reference.resized).length +
    anchorReferences.filter((reference) => reference.resized).length
  // Derived from the list actually returned, not from the intermediate arrays,
  // so the cap slice above cannot make the counts overstate what was sent.
  const keyframeKept = Math.min(keyframeReferences.length, referenceImages.length)
  const anchorKept = Math.max(0, referenceImages.length - keyframeKept)
  const anchorAssetIds = anchorReferences.slice(0, anchorKept).map((reference) => reference.assetId)

  logger.info(
    `[long-take] Seedance 2.5 reference-to-video refs prepared ${formatLogFields({
      anchorReferenceCount: anchorReferences.length,
      // Gap between downloaded and kept is the signal that a user asset was
      // rejected here rather than by the provider -- without it a dropped
      // reference is invisible and looks like the user's asset was ignored.
      droppedAnchorReferenceCount: downloadedAnchorPaths.length - anchorReferences.length,
      intermediateKeyframeCount: intermediatePaths.length,
      projectId: params.projectId,
      referenceAssetIdCount: params.referenceAssetIds?.length ?? 0,
      resizedReferenceCount,
      totalReferenceCount: referenceImages.length,
      transitionId: params.transitionId,
    })}`,
  )
  return {
    anchorAssetIds,
    anchorStartImageIndex: keyframeKept + 1,
    urls: referenceImages,
  }
}

/** Backwards-compatible URL-only facade for callers that do not need identity metadata. */
export async function prepareSeedance25ReferenceImages(
  params: Seedance25ReferenceImageParams,
): Promise<string[] | undefined> {
  return (await prepareSeedance25ReferenceImageSet(params))?.urls
}

/**
 * Downloads the merged-transition waypoint keyframes. Unlike anchors these are
 * NOT dropped on failure: they are our own generated keyframes (failures are
 * infrastructure, not content), and the prompt references them positionally,
 * so a partial list is worse than failing the merged clip and letting the
 * workflow fall back to per-bridge generation.
 */
async function downloadSeedance25AnchorReferences(params: {
  anchors: Array<{ assetId: string; uri: string }>
  /** Number of intermediate waypoint keyframes ahead of the anchors. */
  indexOffset: number
  projectId: string
  tempDir: string
  transitionId: string
}): Promise<Seedance25AnchorReference[]> {
  if (params.anchors.length === 0) {
    return []
  }

  const downloaded = await mapWithConcurrency(params.anchors, 4, async (anchor, index) => {
    const { assetId, uri } = anchor
    const localPath = path.join(
      params.tempDir,
      `reference-${params.transitionId}-${index + params.indexOffset + SEEDANCE25_KEYFRAME_REFERENCE_COUNT + 1}${resolveReferenceImageExtension(uri)}`,
    )
    try {
      await downloadAssetToLocal(uri, localPath)
      return { assetId, path: localPath }
    } catch (error) {
      logger.warn(
        `[long-take] Failed to download Seedance 2.5 anchor reference ${formatLogFields({
          error: formatError(error),
          projectId: params.projectId,
          transitionId: params.transitionId,
          uri,
        })}`,
      )
      return undefined
    }
  })
  return downloaded.filter((value): value is Seedance25AnchorReference => Boolean(value))
}

async function downloadSeedance25IntermediateKeyframes(params: {
  intermediateKeyframeUris: string[]
  tempDir: string
  transitionId: string
}): Promise<string[]> {
  if (params.intermediateKeyframeUris.length === 0) {
    return []
  }
  return mapWithConcurrency(params.intermediateKeyframeUris, 4, async (uri, index) => {
    const localPath = path.join(
      params.tempDir,
      `waypoint-${params.transitionId}-${index + 1}${resolveReferenceImageExtension(uri)}`,
    )
    await downloadAssetToLocal(uri, localPath)
    return localPath
  })
}

function handleUnreadableSeedance25Reference(params: {
  error: unknown
  imagePath: string
  optional: boolean
  projectId: string
  transitionId: string
}): undefined {
  const fields = {
    error: formatError(params.error),
    imagePath: params.imagePath,
    projectId: params.projectId,
    transitionId: params.transitionId,
  }
  if (params.optional) {
    logger.warn(
      `[long-take] Dropping unreadable Seedance 2.5 anchor reference ${formatLogFields(fields)}`,
    )
    return undefined
  }
  throw new Error(
    `[long-take] Unreadable Seedance 2.5 positional reference ${formatLogFields(fields)}`,
  )
}

async function normalizeOptionalSeedance25AnchorReferences(params: {
  anchorPaths: Seedance25AnchorReference[]
  projectId: string
  transitionId: string
}): Promise<Array<NormalizedReferenceImage & { assetId: string }>> {
  if (params.anchorPaths.length === 0) {
    return []
  }

  const kept = await mapWithConcurrency(params.anchorPaths, 4, async ({ assetId, path }) => {
    const normalized = await normalizeSeedance25ReferenceImage({
      imagePath: path,
      optional: true,
      projectId: params.projectId,
      transitionId: params.transitionId,
    })
    return normalized ? { ...normalized, assetId } : undefined
  })
  return kept.filter((value): value is NormalizedReferenceImage & { assetId: string } =>
    Boolean(value),
  )
}

async function normalizeRequiredSeedance25References(params: {
  imagePaths: string[]
  projectId: string
  transitionId: string
}): Promise<NormalizedReferenceImage[]> {
  const references = await mapWithConcurrency(params.imagePaths, 4, async (imagePath) =>
    normalizeSeedance25ReferenceImage({
      imagePath,
      optional: false,
      projectId: params.projectId,
      transitionId: params.transitionId,
    }),
  )
  return references.map((reference) => {
    if (!reference) {
      throw new Error('Required Seedance 2.5 reference unexpectedly dropped')
    }
    return reference
  })
}

async function normalizeSeedance25ReferenceImage(params: {
  imagePath: string
  optional: boolean
  projectId: string
  transitionId: string
}): Promise<NormalizedReferenceImage | undefined> {
  let width: number | undefined
  let height: number | undefined
  try {
    ;({ width, height } = await sharp(params.imagePath).metadata())
  } catch (error) {
    return handleUnreadableSeedance25Reference({ ...params, error })
  }

  if (!width || !height) {
    return handleUnreadableSeedance25Reference({
      ...params,
      error: new Error('missing image dimensions'),
    })
  }

  const plan = resolveSeedance25ReferenceResizePlan(width, height)
  if (!plan) {
    return { path: params.imagePath, resized: false }
  }

  const resizedPath = path.join(
    path.dirname(params.imagePath),
    `${path.basename(params.imagePath, path.extname(params.imagePath))}-sd25-ref.png`,
  )
  try {
    await sharp(params.imagePath).resize(plan.resize).png().toFile(resizedPath)
  } catch (error) {
    return handleUnreadableSeedance25Reference({ ...params, error })
  }

  logger.info(
    `[long-take] ${plan.padded ? 'Letterbox-padded' : 'Upscaled'} Seedance 2.5 reference image ${formatLogFields(
      {
        height,
        imagePath: params.imagePath,
        minDimensionPx: SEEDANCE25_REFERENCE_IMAGE_RULES.minDimensionPx,
        projectId: params.projectId,
        resizedPath,
        targetHeight: plan.resize.height,
        targetWidth: plan.resize.width,
        transitionId: params.transitionId,
        width,
      },
    )}`,
  )
  return { path: resizedPath, resized: true }
}

/**
 * Resolves how a reference image must be re-encoded to satisfy BOTH Ark input
 * bounds, or undefined for the (overwhelmingly common) image that already
 * satisfies them and must pass through byte-for-byte.
 *
 * In-envelope but under the floor: the original ratio-preserving upscale,
 * unchanged. Out of envelope: the CONTENT is first scaled up to the floor,
 * then the short side is padded (black letterbox bars) to one pixel inside the
 * violated bound -- one pixel because Ark's bound inclusivity is unverified,
 * and `ceil` on the padded side already rounds the ratio inward. The long side
 * is capped so a pathological panorama cannot balloon into a multi-hundred-MP
 * canvas (`fit: 'contain'` then shrinks the content into the capped canvas;
 * for extreme ratios that trades content resolution for a bounded file, which
 * beats both an OOM and the old hard rejection). Padding is a
 * deliberate recover-over-reject trade for boundary keyframes too: with
 * `aspectRatio: 'adaptive'` the bars can reach the output geometry, but the
 * alternative was the whole create-task call failing.
 */
function resolveReferenceImageExtension(uri: string): string {
  const cleanUri = uri.split('?')[0] || ''
  const ext = path.extname(cleanUri).toLowerCase()
  return ['.jpeg', '.jpg', '.png', '.webp'].includes(ext) ? ext : '.png'
}

async function resolveSeedance25AnchorReferences(params: {
  projectId: string
  referenceAssetIds?: string[]
  /** Reference slots already taken by boundary + waypoint keyframes. */
  reservedReferenceCount: number
  storage: ReturnType<typeof createLongTakeStorage>
}): Promise<Array<{ assetId: string; uri: string }>> {
  const maxAnchorReferences = SEEDANCE25_MAX_REFERENCE_IMAGES - params.reservedReferenceCount
  if (!params.referenceAssetIds?.length || maxAnchorReferences <= 0) {
    return []
  }

  const lookup = await getLongTakeAnchorLookup(params.storage, params.projectId)
  const anchors: Array<{ assetId: string; uri: string }> = []
  const seen = new Set<string>()
  for (const assetId of params.referenceAssetIds) {
    const uri = lookup.get(assetId)
    if (!uri || seen.has(uri)) {
      continue
    }
    seen.add(uri)
    anchors.push({ assetId, uri })
    if (anchors.length >= maxAnchorReferences) {
      break
    }
  }
  return anchors
}

function resolveSeedance25ReferenceResizePlan(
  width: number,
  height: number,
): undefined | { padded: boolean; resize: ResizeOptions & { height?: number; width?: number } } {
  const { aspectRatio, minDimensionPx } = SEEDANCE25_REFERENCE_IMAGE_RULES
  const ratio = width / height
  if (ratio >= aspectRatio.min && ratio <= aspectRatio.max) {
    if (Math.min(width, height) >= minDimensionPx) {
      return undefined
    }
    return {
      padded: false,
      resize: width <= height ? { width: minDimensionPx } : { height: minDimensionPx },
    }
  }
  const wide = ratio > aspectRatio.max
  // Long-over-short bound; identical for both violations while the envelope
  // is [0.4, 2.5], but derived from the violated bound so they may diverge.
  const boundRatio = wide ? aspectRatio.max : 1 / aspectRatio.min
  const shortSource = wide ? height : width
  const longSource = wide ? width : height
  const contentScale = Math.max(1, minDimensionPx / shortSource)
  const long = Math.min(
    Math.ceil(longSource * contentScale),
    SEEDANCE25_MAX_PADDED_REFERENCE_DIMENSION_PX,
  )
  const short = Math.ceil(long / boundRatio) + 1
  return {
    padded: true,
    resize: {
      background: { alpha: 1, b: 0, g: 0, r: 0 },
      fit: 'contain',
      height: wide ? short : long,
      width: wide ? long : short,
    },
  }
}
