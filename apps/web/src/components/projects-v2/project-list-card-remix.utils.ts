import type { Project } from '@shared/types/api/project'
import type { Attachment } from '@shared/types/assets/attachment'
import type { QuickStartTemplateAsset } from '@shared/types/assets/quick-start'

import type { ApplyLongTakeTemplatePayload } from '@/atom/home'
import { matchStylePreset } from '@/components/omni-chat-box-v2/style/story-mode-style-helpers'
import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'
import type { UserSavedStyle } from '@/hooks/useUserSavedStyles'
import { templateAssetsToAttachments } from '@/util/template-asset-attachments'

export interface ResolvedStyleOverride {
  styleName?: string
  styleThumbnailUrl?: string
}

export interface UserUploadedAssetsResponse {
  assets: QuickStartTemplateAsset[]
  audioUrl: null | string
}

export function buildProjectListRemixPayload(
  project: Project,
  uploadedAssets: null | UserUploadedAssetsResponse,
  resolved?: ResolvedStyleOverride,
  voiceoverAudioUrl?: string,
): ApplyLongTakeTemplatePayload {
  const remixPrompt = getNonEmptyString(project.initPrompt)
  const remixScript = getNonEmptyString(project.script) ?? remixPrompt
  const rawAssets = uploadedAssets?.assets

  // "Voice-over video" detection is prefix-aware: only `video/*` files
  // surfaced under the LEGACY `/user_uploaded/` folder are voice-overs.
  // The assets list can also contain `video/*` files from
  // the UIP visual prefix (`/user-intent-planner/uploads/`) -- those are
  // legitimate visual references uploaded via the chat box and must stay
  // as remix attachments. Keying the filter on URL prefix mirrors the
  // backend's prefix split (MediaService.scanUserUploadedAssetsFromStore).
  //
  // NOTE: the parallel mime-only filters in StoryModeShareLayout.tsx,
  // useLongTakeViewerData.ts, and TemplateVideoCard.tsx still drop UIP
  // visual videos as if they were voice-overs. Those are tracked as a
  // follow-up; they don't break audio (pickTemplateAudioUrl already
  // trusts /user_uploaded/) but they hide visual-reference videos from
  // the share page's asset cards and from template-card remix payloads.
  const isVoiceoverVideo = (asset: { mimeType: string; url: string }): boolean =>
    asset.mimeType.startsWith('video/') && asset.url.includes('/user_uploaded/')
  const hasUploadedVideo = rawAssets?.some(isVoiceoverVideo) ?? false
  const visualAssets = rawAssets?.filter((asset) => !isVoiceoverVideo(asset))
  const attachments = toAttachments(visualAssets)
  // Audio URL precedence mirrors pickTemplateAudioUrl: trust a
  // /user_uploaded/ URL the API returned (surfaces video-as-audio
  // sources there from session-init onwards). Only fall back to
  // voiceoverAudioUrl when the API didn't give us a user_uploaded URL AND
  // a legacy-prefix video voice-over is sitting in assets -- that catches
  // the legacy / DB-fallback case where the BE classifier didn't run.
  const apiAudioUrl = uploadedAssets?.audioUrl ?? undefined
  const audioUrl = apiAudioUrl?.includes('/user_uploaded/')
    ? apiAudioUrl
    : ((hasUploadedVideo ? voiceoverAudioUrl : undefined) ?? apiAudioUrl)

  // Prefer the source page's resolved values (matched against saved + preset
  // styles) over the raw Postgres columns, which are null for pre-2026-04-08
  // projects.
  const styleName = resolved?.styleName ?? getNonEmptyString(project.styleName) ?? undefined
  const styleThumbnailUrl =
    resolved?.styleThumbnailUrl ?? getNonEmptyString(project.styleThumbnailUrl) ?? undefined

  return {
    // Source ratio lives in `longTakeRatio` (the persisted Story Mode column);
    // `aspectRatio` is a rarely-populated type field. Mirror the viewer's
    // firstOf(longTakeRatio, ...) precedence.
    aspectRatio: project.longTakeRatio ?? project.aspectRatio ?? undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    audioUrl,
    // Only literal true is carried; off/unknown omit the field so non-BGM
    // remix payloads stay byte-identical to today.
    bgmEnabled: project.bgmEnabled === true ? true : undefined,
    isStyleCopy: false,
    remixProjectId: project.id,
    script: remixScript || undefined,
    // When the source had uploaded audio, the attachment drives voice at
    // runtime; skip sourceVoice to avoid painting (often-stale) voiceOverJson
    // over the user's pinned default.
    sourceVoice: audioUrl ? undefined : project.voiceOverJson || undefined,
    styleName,
    styleText: getNonEmptyString(project.styleText) || undefined,
    styleThumbnailUrl,
    userPrompt: remixPrompt || undefined,
  }
}

function getNonEmptyString(value: unknown): null | string {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Match the project's styleText against the user's saved styles and the
 * preset catalog to recover a displayable name + thumbnail. Mirrors
 * the cascade in DetailPanel.tsx (saved first, then preset; match signal is
 * `thumbnailUrl !== undefined`). Columns on the Project row always win when
 * present; this function only fills what's null.
 */
export function resolveStyleForRemix(
  styleText: null | string,
  projectStyleName: null | string,
  projectStyleThumbnailUrl: null | string,
  userSavedStyles: UserSavedStyle[],
  presetOptions: StoryModeStyleOption[],
): ResolvedStyleOverride {
  const trimmedText = styleText?.trim() ?? ''
  if (!trimmedText) {
    return {
      styleName: getNonEmptyString(projectStyleName) ?? undefined,
      styleThumbnailUrl: getNonEmptyString(projectStyleThumbnailUrl) ?? undefined,
    }
  }

  const savedAsOptions: StoryModeStyleOption[] = userSavedStyles.map((s) => ({
    id: `saved:${s.id}`,
    label: s.name,
    styleText: s.styleText,
    thumbnailUrl: s.thumbnailUrl ?? '',
  }))
  const allOptions = [...savedAsOptions, ...presetOptions]
  const matched = matchStylePreset(
    trimmedText,
    allOptions,
    getNonEmptyString(projectStyleName) ?? undefined,
  )
  const hasMatch = matched.thumbnailUrl !== undefined

  return {
    styleName: getNonEmptyString(projectStyleName) ?? (hasMatch ? matched.styleName : undefined),
    // Empty-string thumbnails cascade through (text-mode saved styles have
    // no thumb). Only use the matched thumbnail when it's truthy.
    styleThumbnailUrl:
      getNonEmptyString(projectStyleThumbnailUrl) ??
      (matched.thumbnailUrl && matched.thumbnailUrl.length > 0 ? matched.thumbnailUrl : undefined),
  }
}

function toAttachments(assets: QuickStartTemplateAsset[] | undefined): Attachment[] {
  if (!assets || assets.length === 0) {
    return []
  }
  return templateAssetsToAttachments(
    assets.filter(
      (asset) => asset.mimeType.startsWith('image/') || asset.mimeType.startsWith('video/'),
    ),
  )
}
