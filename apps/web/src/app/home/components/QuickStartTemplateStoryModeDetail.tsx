'use client'

import { LOCAL_USER_ID } from '@reelmakeeasy/common/auth/local-identity'
import type { QuickStartTemplate, QuickStartTemplateAsset } from '@shared/types/assets/quick-start'
import type { DebugSettings } from '@shared/types/project/debug-settings'
import { cn } from '@shared/ui'
import { useAtomValue, useSetAtom } from 'jotai'
import React, { useEffect, useMemo } from 'react'

import { useLongTakeArtifacts } from '@/app/long-take/hooks/useLongTakeArtifacts'
import { DetailPanel as StoryModeDetailPanel } from '@/app/story-mode/components/LongTakeViewer/DetailPanel'
import { projectIdAtom } from '@/atom/project'
import { useCdnOrigin } from '@/hooks/useCdnOrigin'
import { useProjectAtom } from '@/hooks/useProjects'
import { getWorkspaceAudioUrl } from '@/util/cdn-utils'
import { VideoMetaLoader } from '@/util/video-metadata'

import { useHydratedDemoTemplate } from '../hooks/useHydratedDemoTemplate'

import { detectClosestAspectRatioLabel } from './QuickStartTemplateDialogHooks'
import type { QuickStartVideoMetadataAtom } from './QuickStartTemplateDialogTypes'

const useResolvedStoryModeTemplateData = (
  template: QuickStartTemplate,
  videoMetadataAtom: QuickStartVideoMetadataAtom,
) => {
  const setProjectId = useSetAtom(projectIdAtom)
  const videoMetadataMap = useAtomValue(videoMetadataAtom)
  const setVideoMetadata = useSetAtom(videoMetadataAtom)
  const { projectInfo, error: projectError } = useProjectAtom()
  const isProjectOwner = projectInfo?.owner === LOCAL_USER_ID
  const artifacts = useLongTakeArtifacts(template.projectId)
  const finalVideoUrl = artifacts.videoUrl || template.resultVideo || undefined
  const cachedVideoMetadata = finalVideoUrl ? videoMetadataMap.get(finalVideoUrl) : undefined
  const isCurrentVideoMetadataReady = Boolean(
    cachedVideoMetadata && cachedVideoMetadata.status === 'ready',
  )
  const detectedRatio = isCurrentVideoMetadataReady ? cachedVideoMetadata?.ratioLabel : undefined

  useEffect(() => {
    if (!template.projectId) {
      return
    }
    setProjectId(template.projectId)
    return () => {
      setProjectId('')
    }
  }, [setProjectId, template.projectId])

  useEffect(() => {
    if (!finalVideoUrl || cachedVideoMetadata?.status === 'ready') {
      return
    }

    setVideoMetadata((prev) => {
      const current = prev.get(finalVideoUrl)
      if (current && current.status === 'pending') {
        return prev
      }

      const next = new Map(prev)
      next.set(finalVideoUrl, {
        duration: 0,
        ratioLabel: undefined,
        status: 'pending',
      })
      return next
    })

    const loader = new VideoMetaLoader(finalVideoUrl)
    loader.onLoadedMetadata = (video) => {
      const ratioLabel = detectClosestAspectRatioLabel(video.videoWidth, video.videoHeight)
      const normalizedDuration = Number.isFinite(video.duration) ? video.duration : 0

      setVideoMetadata((prev) => {
        const current = prev.get(finalVideoUrl)
        if (
          current &&
          current.status === 'ready' &&
          current.duration === normalizedDuration &&
          current.ratioLabel === ratioLabel
        ) {
          return prev
        }

        const next = new Map(prev)
        next.set(finalVideoUrl, {
          duration: normalizedDuration,
          ratioLabel,
          status: 'ready',
        })
        return next
      })
    }
    loader.onError = () => {
      setVideoMetadata((prev) => {
        const current = prev.get(finalVideoUrl)
        if (current && current.status === 'error') {
          return prev
        }

        const next = new Map(prev)
        next.set(finalVideoUrl, {
          duration: 0,
          ratioLabel: undefined,
          status: 'error',
        })
        return next
      })
    }

    return () => {
      loader.dispose()
    }
  }, [cachedVideoMetadata?.status, finalVideoUrl, setVideoMetadata])

  const isOwner = useMemo(() => {
    if (projectError) {
      return false
    }
    if (projectInfo) {
      return isProjectOwner
    }
    return false
  }, [isProjectOwner, projectError, projectInfo])

  const stage = artifacts.status?.stage
  const script =
    artifacts.status?.script ||
    artifacts.script ||
    projectInfo?.script ||
    template.transcript ||
    template.s2vLandingPageMeta?.transcript
  // Mirror the carousel card's fallback chain
  // (apps/web/src/components/template-card/TemplateVideoCard.tsx) so the
  // dialog's Remix/Copy-Style buttons enable on the same demos the card
  // overlay enables. Without this, demos that only populate styleDescription/
  // styleName/title get styleText=undefined and useStoryModeShareActions
  // disables both actions on canRemix=!!styleText.
  const styleText =
    artifacts.status?.styleText ||
    artifacts.styleText ||
    template.styleText ||
    template.styleDescription ||
    template.styleName ||
    template.title ||
    undefined
  const styleName =
    artifacts.status?.styleName ||
    artifacts.styleName ||
    template.styleName ||
    template.styleText ||
    template.title ||
    template.industries?.[0] ||
    undefined
  const styleThumbnailUrl =
    artifacts.status?.styleThumbnailUrl ||
    artifacts.styleThumbnailUrl ||
    template.styleThumbnailUrl ||
    template.assets.find((asset) => asset.mimeType.startsWith('image/'))?.url ||
    template.thumbnail ||
    undefined
  const ratio = projectInfo?.longTakeRatio || detectedRatio || template.aspectRatio || '9:16'

  // Resolve the model badges from the demo's MongoDB snapshot first so they
  // appear instantly with the rest of the template, instead of waiting ~1s on
  // the live project fetch. Only fall back to the live project when the snapshot
  // field is genuinely absent (undefined). A snapshot of `null` is authoritative
  // (no image badge / Seedance 1.5 default) and must win, so we check
  // `!== undefined` rather than using `??`.
  const liveVideoModel = projectInfo
    ? ((projectInfo.debugSettings as DebugSettings | undefined)?.transitionVideoModel ?? null)
    : undefined

  return {
    finalVideoUrl,
    isOwner,
    projectInfo: projectInfo ?? undefined,
    ratio,
    script,
    stage,
    styleName,
    styleText,
    styleThumbnailUrl,
    videoModel: template.videoModel === undefined ? liveVideoModel : template.videoModel,
  }
}

// Videos in user_uploaded/ are voice-overs by product invariant; the shared
// remix hook drops them from attachments and forwards templateAudioUrl as the
// remix audioUrl. When a demo template's source had an uploaded video,
// template.audioUrl is empty, so derive the deterministic voice_over.mp3 URL
// here. Mirrors buildProjectListRemixPayload on the my-projects path.
function resolveDemoTemplateAudioUrl(
  template: QuickStartTemplate,
  cdnOrigin: string,
): string | undefined {
  const hasUploadedVideo = template.assets.some((asset) => asset.mimeType.startsWith('video/'))
  if (hasUploadedVideo) {
    return getWorkspaceAudioUrl(cdnOrigin, template.projectId)
  }
  return template.audioUrl ?? undefined
}

export const StoryModeTemplateDetail: React.FC<{
  isMobile?: boolean
  mobileActionsPortalElement?: HTMLDivElement | null
  onPreviewAssetChange?: (asset: null | QuickStartTemplateAsset) => void
  template: QuickStartTemplate
  videoHeight?: number
  videoMetadataAtom: QuickStartVideoMetadataAtom
}> = ({
  template: cardTemplate,
  videoHeight,
  isMobile = false,
  mobileActionsPortalElement,
  onPreviewAssetChange,
  videoMetadataAtom,
}) => {
  // The gallery list omits initPrompt/transcript; pull them for this demo.
  const template = useHydratedDemoTemplate(cardTemplate)
  const {
    finalVideoUrl,
    isOwner,
    ratio,
    script,
    stage,
    styleName,
    styleText,
    styleThumbnailUrl,
    videoModel,
  } = useResolvedStoryModeTemplateData(template, videoMetadataAtom)
  const cdnOrigin = useCdnOrigin()

  const detailAssets = useMemo(
    () =>
      template.assets.filter(
        (asset) => asset.mimeType.startsWith('image/') || asset.mimeType.startsWith('video/'),
      ),
    [template.assets],
  )

  return (
    <div
      className={cn(
        'shrink-0',
        isMobile
          ? 'w-full'
          : // w-88 (352px) is the story-mode project page's own panel width
            // (StoryModeFrame). Flat rather than responsive so the dialog does
            // not resize its panel as the carousel moves between demos.
            'w-88 h-full min-h-0 overflow-hidden',
      )}
      style={!isMobile && videoHeight ? { height: `${videoHeight}px` } : {}}
    >
      <StoryModeDetailPanel
        assets={detailAssets}
        initPrompt={template.initPrompt}
        inputTypeLabel={template.inputType ?? undefined}
        isMobile={isMobile}
        isOwner={isOwner}
        mobileActionsPortalElement={isMobile ? mobileActionsPortalElement : null}
        onPreviewAssetChange={onPreviewAssetChange}
        projectId={template.projectId}
        ratio={ratio}
        script={script}
        showUserPrompt
        sourceVoice={template.voiceOverJson ?? undefined}
        stage={stage}
        styleName={styleName}
        styleText={styleText}
        styleThumbnailUrl={styleThumbnailUrl}
        templateAudioUrl={resolveDemoTemplateAudioUrl(template, cdnOrigin)}
        trackingSource="demo_page"
        useCase={template.useCases?.[0]}
        videoModel={videoModel}
        videoUrl={finalVideoUrl}
      />
    </div>
  )
}
