import type { AspectRatio, ProjectVoiceOverJson } from '@shared/types/api/project'
import type { QuickStartTemplateAsset } from '@shared/types/assets/quick-start'
import { toast } from '@shared/ui'
import { useParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'

import { REMIX_QUERY_KEY, USE_THIS_STYLE_QUERY_KEY } from '@/app/home/constants/urlTransferKeys'
import { useQuickStartNavigation } from '@/app/home/hooks/useQuickStartNavigation'
import { setUrlTransfer } from '@/hooks/useUrlTransfer'
import { showLinkCopiedToast } from '@/util/share-toast'
import { templateAssetsToAttachments } from '@/util/template-asset-attachments'

export type StoryModeShareActionSource = 'demo_page' | 'project_page' | 'share_page'

interface UseStoryModeShareActionsParams {
  assets?: QuickStartTemplateAsset[]
  // Source project's BGM state (long-take status poll). Only literal true is
  // carried into the remix payload; volume/prompt never carry.
  bgmEnabled?: boolean | null
  initPrompt?: string
  inputType?: string
  isOwner?: boolean
  isSharePage?: boolean
  projectId: string
  ratio?: string
  resolvedStyleName?: string
  resolvedStyleThumbnailUrl?: string
  script?: string
  // Where the action was triggered from. Wins over `isSharePage`.
  source?: StoryModeShareActionSource
  sourceVoice?: null | ProjectVoiceOverJson
  styleName?: string
  styleText?: string
  styleThumbnailUrl?: string
  templateAudioUrl?: string
}

export function useStoryModeShareActions({
  assets,
  bgmEnabled,
  initPrompt,
  inputType,
  isSharePage,
  isOwner,
  projectId,
  ratio,
  resolvedStyleName,
  resolvedStyleThumbnailUrl,
  script,
  source,
  sourceVoice,
  styleName,
  styleText,
  styleThumbnailUrl,
  templateAudioUrl,
}: UseStoryModeShareActionsParams) {
  const { navigate } = useQuickStartNavigation()
  const params = useParams()
  const shareId = typeof params?.shareId === 'string' ? params.shareId : undefined
  const trackingSource: StoryModeShareActionSource =
    source ?? (isSharePage ? 'share_page' : 'project_page')

  const effectiveStyleName = resolvedStyleName ?? styleName
  const effectiveStyleThumbnailUrl = resolvedStyleThumbnailUrl ?? styleThumbnailUrl

  // Both actions require a style to be meaningful
  const canCopyStyle = !!styleText
  const canRemix = !!styleText

  const handleCopyStyle = useCallback(() => {
    const query = setUrlTransfer({
      [USE_THIS_STYLE_QUERY_KEY]: {
        previewUrl: effectiveStyleThumbnailUrl,
        remixProjectId: projectId,
        isStyleCopy: true,
        styleName: effectiveStyleName,
        styleThumbnailUrl: effectiveStyleThumbnailUrl,
        styleText,
      },
    })
    navigate('story-mode', query)
  }, [
    navigate,
    inputType,
    trackingSource,
    projectId,
    effectiveStyleName,
    effectiveStyleThumbnailUrl,
    styleText,
  ])

  const handleRemix = useCallback(async () => {
    // Videos in user_uploaded/ are always voice-overs, never visual assets
    // (product invariant). The voice-over audio is forwarded separately via
    // `audioUrl: templateAudioUrl` below, so video files must not leak into
    // the remix attachment list or the new project would treat them as
    // visual inputs.
    const remixAttachments = templateAssetsToAttachments(
      (assets ?? []).filter((asset) => asset.mimeType.startsWith('image/')),
    )
    // Demos aren't a /share/ route and resolve via the carry-uip-context
    // demo hop (no Project row / shareId), so never forward a stray shareId
    // for them. The composer's late carry fetch uses it to view a
    // shared non-owned source.
    const carryShareId = trackingSource === 'demo_page' ? undefined : shareId

    const query = setUrlTransfer({
      [REMIX_QUERY_KEY]: {
        attachments: remixAttachments.length > 0 ? remixAttachments : undefined,
        // Carry the source's display ratio (computed by the viewer from
        // longTakeRatio). Narrow to the AspectRatio union; ignore anything else.
        aspectRatio:
          ratio === '1:1' || ratio === '9:16' || ratio === '16:9'
            ? (ratio as AspectRatio)
            : undefined,
        audioUrl: templateAudioUrl,
        // Only literal true is carried; off/unknown omit the field so
        // non-BGM remix payloads stay byte-identical.
        bgmEnabled: bgmEnabled === true ? true : undefined,
        previewUrl: effectiveStyleThumbnailUrl,
        remixProjectId: projectId,
        isStyleCopy: false,
        script: script || initPrompt || undefined,
        shareId: carryShareId,
        sourceVoice: sourceVoice || undefined,
        styleName: effectiveStyleName,
        styleThumbnailUrl: effectiveStyleThumbnailUrl,
        styleText,
        userPrompt: initPrompt || undefined,
      },
    })
    navigate('story-mode', query)
  }, [
    navigate,
    shareId,
    bgmEnabled,
    script,
    initPrompt,
    inputType,
    isOwner,
    ratio,
    trackingSource,
    projectId,
    effectiveStyleName,
    effectiveStyleThumbnailUrl,
    resolvedStyleName,
    styleText,
    assets,
    sourceVoice,
    templateAudioUrl,
  ])

  const handleShare = useCallback(async () => {
    try {
      const isPublicUrl = trackingSource === 'demo_page' || trackingSource === 'share_page'
      const url = isPublicUrl
        ? window.location.href
        : new URL(`/story-mode/${projectId}`, window.location.origin).toString()
      await navigator.clipboard.writeText(url)
      showLinkCopiedToast()
    } catch {
      toast.error('Failed to copy link')
    }
  }, [isOwner, projectId, trackingSource])

  const actions = useMemo(
    () => ({
      canCopyStyle,
      canRemix,
      handleCopyStyle,
      handleRemix,
      handleShare,
    }),
    [canCopyStyle, canRemix, handleCopyStyle, handleRemix, handleShare],
  )
  return actions
}
