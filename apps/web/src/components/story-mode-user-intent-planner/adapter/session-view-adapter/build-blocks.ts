import { isStoreUri, storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { countWords } from '@reelmakeeasy/common/utils/text'

import type {
  AnchorAssetListBlock,
  AssetRef,
  AssetStatus,
  BrandBriefCardBlock,
  ScriptTranscriptBlock,
  StoryboardsBlock,
  StoryboardShot,
  StyleCandidatesBlock,
  VideoBriefCardBlock,
} from '../../state-types'
import type { PlannerPhase, SessionChangedEventAnchorAsset, SessionState } from '../api-types'

import { resolveSessionAudioUrl } from './audio-url'
import { isPhaseAtOrAfterVisualRenderLock, PHASE_INDEX } from './constants'

export interface BuildAssetPreviewOptions {
  cdnOrigin?: string
  sessionId?: string
}
type AnchorAssetListInput = Pick<SessionState, 'anchor_assets' | 'uploaded_assets'>
type BrandBriefCardInput = Pick<SessionState, 'global_constraints' | 'phase'>
type ScriptTranscriptInput = Pick<
  SessionState,
  'audio_path' | 'audio_source' | 'audio_url' | 'script'
>

type StoryboardsInput = Pick<SessionState, 'anchor_assets' | 'phase' | 'shots' | 'uploaded_assets'>

type StyleCandidatesInput = Pick<SessionState, 'global_constraints' | 'locked_at' | 'phase'>

type VideoBriefCardInput = Pick<SessionState, 'global_constraints' | 'mode_state'>

export function buildAnchorAssetListBlockFromState(
  state: AnchorAssetListInput,
  options?: BuildAssetPreviewOptions,
): AnchorAssetListBlock | null {
  const anchorAssetsPool = buildAnchorAssetsPool(state.anchor_assets, options)

  // Hide the panel only when the session has no anchors at all. A pool of purely non-ready
  // anchors still renders -- as placeholders -- because "three anchors failed" is information
  // the user needs, not an empty state.
  if (!anchorAssetsPool.length) {
    return null
  }

  return {
    blockStatus: 'default',
    id: 'block-anchor-asset-list',
    items: anchorAssetsPool,
    kind: 'anchor_asset_list',
  }
}

export function buildAnchorAssetsPool(
  anchorAssets: SessionState['anchor_assets'],
  options?: BuildAssetPreviewOptions,
): AssetRef[] {
  const result: AssetRef[] = []
  const seen = new Set<string>()

  for (const anchor of anchorAssets ?? []) {
    const id = normalizeOptionalText(anchor.anchor_id)
    if (!id || seen.has(id)) {
      continue
    }

    seen.add(id)
    // Every anchor stays in the pool, ready or not, carrying its status: the pool is the only
    // record the client has that a given anchor exists.
    // Prefer a ready-made URL beside the path when the payload carries one.
    const previewUrl =
      anchor.preview_url?.trim() ||
      (anchor.preview_relative_path
        ? resolveUploadedAssetPreviewUrl(
            options?.sessionId,
            anchor.preview_relative_path,
            options?.cdnOrigin,
          )
        : undefined)
    result.push({
      id,
      label: normalizeOptionalText(anchor.label) || id,
      previewAssetId: anchor.preview_asset_id,
      previewUrl,
      status: resolveAnchorStatus(previewUrl, anchor.status),
      type: 'img',
    })
  }

  return result
}

export function buildScriptTranscriptBlockFromState(
  state: ScriptTranscriptInput,
  options?: BuildAssetPreviewOptions,
): null | ScriptTranscriptBlock {
  const script = normalizeScriptText(state.script?.content)
  if (!script) {
    return null
  }

  const audioUrl = resolveSessionAudioUrl(state, options?.sessionId, options?.cdnOrigin)

  const guiRequestId = state.script?.gui_request_id || undefined

  return {
    ...(audioUrl ? { audioUrl } : {}),
    ...(guiRequestId ? { guiRequestId } : {}),
    audioSource: state.audio_source ?? null,
    blockStatus: 'default',
    id: 'item-script-transcript',
    kind: 'script_transcript',
    text: script,
  }
}

export function buildStoryboardsBlockFromState(
  state: StoryboardsInput,
  options?: BuildAssetPreviewOptions,
): null | StoryboardsBlock {
  // Refinement's card is already on screen, so a null block would freeze the last rendered cell on
  // stale shots; earlier phases are still generating, where zero shots only means "not yet".
  const isRefinementOrLater =
    state.phase != null && PHASE_INDEX[state.phase] >= PHASE_INDEX.refinement
  if (state.shots.length === 0 && !isRefinementOrLater) {
    return null
  }

  const uploadedAssetsPool = buildUploadedAssetsPool(state.uploaded_assets, options)
  const anchorAssetsPool = buildAnchorAssetsPool(state.anchor_assets, options)
  const assetsPool = mergeAssetPools(uploadedAssetsPool, anchorAssetsPool)
  const assetsPoolById = new Map(assetsPool.map((asset) => [asset.id, asset]))

  const shots: StoryboardShot[] = []
  let cumulativeSeconds = 0

  for (const shot of state.shots) {
    const shotId = normalizeOptionalText(shot.shot_id) || `shot-${shots.length + 1}`
    const visualDescription = normalizeOptionalText(shot.visual_primary?.core_description)
    const voiceOver = normalizeOptionalText(shot.audio_vo)
    // Prefer the spec's ASR-aligned timing; the word-count estimate (150 wpm) is only
    // a fallback for legacy events that carry no time field.
    const startSeconds = shot.time?.start_s ?? cumulativeSeconds
    const endSeconds = shot.time?.end_s ?? startSeconds + countWords(voiceOver) / 2.5
    cumulativeSeconds = endSeconds

    shots.push({
      assets: normalizeShotAssets(shot.pre_selected_assets, assetsPoolById),
      endSeconds,
      id: shotId,
      shotNumber: shot.order,
      startSeconds,
      title: visualDescription ? `Shot${shot.order} · ${visualDescription}` : `Shot${shot.order}`,
      voiceOver: voiceOver ? `VO: ${voiceOver}` : '',
    })
  }

  return {
    blockStatus: 'default',
    id: 'block-storyboards',
    kind: 'storyboards',
    shots,
  }
}

/**
 * Auto Style Selection candidates block. Visible whenever
 * the agent has offered a set of style candidates and the session is still in
 * `style_mode: 'auto'` -- once the user (or the agent) switches to manual style
 * control, the candidates rail is no longer meaningful and the block hides.
 * `readOnly` mirrors the backend's visual-render lock condition (uip-set-style.ts):
 * folded phase >= bootstrap_visual OR `locked_at` is already stamped, so the
 * card's read-only state can never diverge from the setStyle 409 the API
 * would otherwise return.
 */
export function buildStyleCandidatesBlockFromState(
  state: StyleCandidatesInput,
): null | StyleCandidatesBlock {
  const candidates = state.global_constraints?.style_candidates ?? []
  const styleMode = state.global_constraints?.style_mode

  if (candidates.length === 0 || styleMode !== 'auto') {
    return null
  }

  return {
    appliedStyleName: state.global_constraints?.style?.style_name ?? null,
    blockStatus: 'default',
    candidates,
    id: 'item-style-candidates',
    kind: 'style_candidates',
    readOnly: isPastVisualRenderLock(state.phase, state.locked_at),
  }
}

export function buildUploadedAssetsPool(
  uploadedAssets: SessionState['uploaded_assets'],
  options?: BuildAssetPreviewOptions,
): AssetRef[] {
  const result: AssetRef[] = []
  const seen = new Set<string>()

  for (const asset of uploadedAssets) {
    const id = normalizeOptionalText(asset.asset_id)
    if (!id || seen.has(id)) {
      continue
    }

    seen.add(id)
    const previewUrl = resolveUploadedAssetPreviewUrl(
      options?.sessionId,
      normalizeOptionalText(asset.preview_url) || asset.file_path,
      options?.cdnOrigin,
    )
    result.push({
      id,
      label: normalizeOptionalText(asset.file_name) || id,
      previewAssetId: asset.preview_asset_id,
      previewUrl,
      type: mapAssetType(asset.content_type),
    })
  }

  return result
}

/**
 * Placeholder Brand Brief block. Visible during
 * `bootstrap_brand` (extraction in flight) and `brand_review` (gate
 * ready). Also admitted once the bank is locked, so the first post-confirm
 * push -- which advances the phase to `bootstrap_script` in the same
 * synchronous step as the lock -- still renders a fresh card carrying the
 * filtered, locked bank that supersedes the stale pre-edit snapshot.
 * Returns `null` otherwise so the renderer skips the block entirely. The
 * component dumps `brand_bank` as JSON.
 */
export function buildBrandBriefCardBlockFromState(
  state: BrandBriefCardInput,
  guiRequestId?: string,
): BrandBriefCardBlock | null {
  const phase = state.phase as null | PlannerPhase | undefined
  const brandBankLockedAt = state.global_constraints?.brand_bank_locked_at ?? null
  if (phase !== 'bootstrap_brand' && phase !== 'brand_review' && !brandBankLockedAt) {
    return null
  }

  const status = mapBrandBriefStatus(state)
  // Don't show the card before extraction has actually started; the transition
  // to bootstrap_brand can briefly precede the first brand_extraction_status
  // update, leaving the card with no content or loading signal.
  if (status === 'pending_input') {
    return null
  }
  const brandBank = state.global_constraints?.brand_bank ?? null
  const failureReason = state.global_constraints?.brand_extraction_failure_reason ?? null
  const styleThumbnailUrl = state.global_constraints?.style?.style_thumbnail_url ?? null
  const selectedStyleName = state.global_constraints?.style?.style_name ?? null
  const selectedStyleText = state.global_constraints?.style?.style_text ?? null
  const brandBankSource = state.global_constraints?.brand_bank_source ?? null
  const fromSavedBrief = brandBankSource?.kind === 'brand_library'
  const savedBriefId = fromSavedBrief ? (brandBankSource?.brief_id ?? null) : null

  return {
    ...(guiRequestId ? { guiRequestId } : {}),
    blockStatus: 'default',
    brandBank,
    brandBankLockedAt,
    failureReason,
    fromSavedBrief,
    id: 'item-brand-brief-card',
    kind: 'brand_brief_card',
    savedBriefId,
    selectedStyleName,
    selectedStyleText,
    status,
    styleThumbnailUrl,
    title: 'Brand brief',
  }
}

export function buildVideoBriefCardBlockFromState(
  state: VideoBriefCardInput,
): null | VideoBriefCardBlock {
  const videoType = normalizeOptionalText(state.global_constraints.video_type)

  // Strict existence: video brief exists only when video_type is non-empty.
  if (!videoType) {
    return null
  }

  const topic = normalizeOptionalText(state.global_constraints.topic)
  const targetAudience = normalizeOptionalText(state.global_constraints.target_audience)
  const pacing = normalizeOptionalText(state.global_constraints.pacing)
  const tone = normalizeOptionalText(state.global_constraints.tone)
  const durationSecondsFallback = state.mode_state?.duration_seconds ?? null
  const directives = (state.global_constraints.directives ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
  const mustNotViolate = (state.global_constraints.must_not_violate ?? [])
    .map((item) => item.trim())
    .filter(Boolean)

  const formattedVideoType = formatVideoType(videoType)

  return {
    blockStatus: 'default',
    description: topic || 'No summary yet.',
    directives,
    durationSecondsFallback,
    id: 'item-video-brief-card',
    kind: 'video_brief_card',
    longMetaItems: [
      { label: 'AUDIENCE', value: targetAudience || '-' },
      { label: 'PACING', value: pacing || '-' },
      { label: 'TONE', value: tone || '-' },
    ],
    metaItems: [
      { label: 'AUDIENCE', value: targetAudience || '-' },
      { label: 'TONE', value: tone || '-' },
      { label: 'PACING', value: pacing || '-' },
    ],
    mustNotViolate,
    title: `${formattedVideoType} Brief`,
    videoType: formattedVideoType,
  }
}

function formatVideoType(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

// Mirrors the backend's visual-render lock condition (apps/services/api/src/uip/
// uip-set-style.ts): once the folded phase has advanced past bootstrap_visual, or
// locked_at is already stamped, the style is baked into the render pipeline and
// setStyle would 409. Keeping the FE gate in lockstep avoids a switch attempt the
// API would just reject.
function isPastVisualRenderLock(phase: SessionState['phase'], lockedAt: null | string): boolean {
  return isPhaseAtOrAfterVisualRenderLock(phase) || Boolean(lockedAt?.trim())
}

function mapAssetType(contentType: string): AssetRef['type'] {
  if (contentType.startsWith('image/')) {
    return 'img'
  }
  if (contentType.startsWith('video/')) {
    return 'video'
  }
  if (contentType.startsWith('audio/')) {
    return 'audio'
  }
  if (contentType === 'application/pdf') {
    return 'pdf'
  }
  if (contentType.startsWith('text/')) {
    return 'txt'
  }
  return 'file'
}

function mapBrandBriefStatus(state: BrandBriefCardInput): BrandBriefCardBlock['status'] {
  const phase = state.phase
  const extractionStatus = state.global_constraints?.brand_extraction_status
  if (phase === 'brand_review') {
    return 'review_ready'
  }
  // Once the bank is locked the phase has already advanced past brand_review.
  // Surface the locked snapshot as a review-ready card so the block
  // renders (read-only, since the brand-review gate is now closed) instead of
  // falling through to pending_input, which suppresses the block entirely.
  if (state.global_constraints?.brand_bank_locked_at) {
    return 'review_ready'
  }
  if (extractionStatus === 'failed') {
    return 'failed'
  }
  if (extractionStatus === 'pending') {
    return 'in_progress'
  }
  return 'pending_input'
}

function mergeAssetPools(uploadedAssetsPool: AssetRef[], anchorAssetsPool: AssetRef[]): AssetRef[] {
  const result: AssetRef[] = []
  const seen = new Set<string>()

  for (const asset of [...uploadedAssetsPool, ...anchorAssetsPool]) {
    if (!asset.id || seen.has(asset.id)) {
      continue
    }

    seen.add(asset.id)
    result.push(asset)
  }

  return result
}

/**
 * A resolved preview path is the ground truth for "displayable", so it outranks the wire status,
 * which can read ready before the path lands. With no path the anchor is never ready: a wire
 * `ready`, or a legacy event carrying no status at all, means the image is still on its way.
 */
function normalizeOptionalText(value: null | string | undefined): string {
  return value?.trim() ?? ''
}

function resolveAnchorStatus(
  previewUrl: string | undefined,
  wireStatus: SessionChangedEventAnchorAsset['status'] | undefined,
): AssetStatus {
  if (previewUrl) {
    return 'ready'
  }
  return wireStatus === 'failed' || wireStatus === 'planned' ? wireStatus : 'generating'
}

// Collapses \n differences injected by visual script generation so the same
// content with different line-break formatting doesn't create phantom Outdated blocks.
// Exported so the transcript-version history dedups on the same key.
export function normalizeScriptText(value: null | string | undefined): string {
  return normalizeOptionalText(value).replace(/\n+/g, ' ').replace(/ {2,}/g, ' ')
}

function normalizeShotAssets(
  value:
    | Array<{
        asset_id: string
        source: 'anchor_asset' | 'user_upload'
      }>
    | undefined,
  assetsPoolById: Map<string, AssetRef>,
): AssetRef[] {
  const result: AssetRef[] = []
  const seen = new Set<string>()

  for (const item of value ?? []) {
    const assetId = normalizeOptionalText(item.asset_id)
    if (!assetId || seen.has(assetId)) {
      continue
    }

    seen.add(assetId)
    const fromPool = assetsPoolById.get(assetId)

    result.push(
      fromPool ?? {
        id: assetId,
        label: assetId,
        type: 'file',
      },
    )
  }

  return result
}

function resolveUploadedAssetPreviewUrl(
  sessionId: string | undefined,
  fileUri: string,
  cdnOrigin?: string,
): string {
  const rawPath = fileUri.trim()
  if (!rawPath) {
    return ''
  }
  if (/^https?:\/\//i.test(rawPath)) {
    return rawPath
  }
  if (isStoreUri(rawPath)) {
    // storeUriToUrl encodes each path segment, so a `#` or `?` in a filename stays
    // part of the name rather than reading as a fragment or query.
    return storeUriToUrl(rawPath)
  }

  // Demo-cloned sessions sometimes nest a full URL inside file_path; recover it.
  const embedded = rawPath.match(/https:\/\/.+$/)?.[0]
  if (embedded) {
    const slash = embedded.lastIndexOf('/')
    const head = embedded.slice(0, slash)
    const tail = embedded.slice(slash + 1)
    return head.endsWith(`/${tail}`) ? head : embedded
  }

  if (!sessionId?.trim()) {
    return ''
  }

  const normalizedPath = rawPath.replace(/^\/+/, '')
  const fullPath = `projects/${sessionId}/user-intent-planner/${normalizedPath}`
  // Encode before composing with the origin. URL parser would otherwise treat
  // raw `#` / `?` in a filename as fragment / query boundaries.
  const encodedPath = encodeAssetPathSegments(fullPath)

  if (!cdnOrigin?.trim()) {
    return `/${encodedPath}`
  }
  return `${cdnOrigin.replace(/\/+$/, '')}/${encodedPath}`
}

/**
 * Percent-encode each path segment for a brand-asset preview URL. Filenames
 * come from third-party sites and macOS Screenshot timestamps (U+202F narrow
 * no-break space); raw URLs with those chars fail CORS preflight when
 * ExternalImage fetches with crossOrigin="anonymous".
 *
 * `encodeURIComponent` per-segment is used instead of URL-parser
 * normalization so filenames containing `#` or `?` aren't misinterpreted as
 * fragment / query.
 */
function encodeAssetPathSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}
