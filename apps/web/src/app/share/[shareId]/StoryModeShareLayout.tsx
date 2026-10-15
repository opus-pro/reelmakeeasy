'use client'

import type { QuickStartTemplateAsset } from '@shared/types/assets/quick-start'
import { type ReactNode, useEffect, useState } from 'react'

import FinalVideoView from '@/app/story-mode/components/LongTakeViewer/FinalVideoView'
import { StoryModeAssetPreviewDialog } from '@/app/story-mode/components/StoryModeAssetPreviewDialog'
import { pickTemplateAudioUrl } from '@/app/story-mode/hook/templateAudio'
import { useLongTakeViewerData } from '@/app/story-mode/hook/useLongTakeViewerData'
import { useIsMobile } from '@/util/browserUtils'

interface StoryModeShareLayoutProps {
  onClose: () => void
  projectId: string
  topOverlay?: ReactNode
}

export function StoryModeShareLayout({
  onClose,
  projectId,
  topOverlay,
}: StoryModeShareLayoutProps) {
  const data = useLongTakeViewerData(projectId)
  const [previewAsset, setPreviewAsset] = useState<null | QuickStartTemplateAsset>(null)
  const isMobile = useIsMobile()

  useEffect(() => {
    if (previewAsset) {
      return
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, previewAsset])

  // A video file in user_uploaded/ is always a voice-over (product
  // invariant), never a visual asset. Use its presence to drive the audio
  // pill; exclude it from the "User Assets" card list.
  const unfilteredAssets = data.assets ?? []
  const hasUploadedVideo = unfilteredAssets.some((asset) => asset.mimeType.startsWith('video/'))
  const detailAssets = unfilteredAssets.filter((asset) => !asset.mimeType.startsWith('video/'))
  const detailTemplateAudioUrl = pickTemplateAudioUrl({
    hasUploadedVideo,
    uploadedAudioUrl: data.uploadedAudioUrl,
    voiceoverAudioUrl: data.audioUrl,
  })

  if (!projectId || data.isLoading) {
    return null
  }

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-background">
      <FinalVideoView
        assets={detailAssets}
        concurrentStages={data.concurrentStages}
        initPrompt={data.initPrompt}
        isMobile={isMobile}
        isOwner={data.isOwner}
        onClose={onClose}
        onPreviewAssetChange={setPreviewAsset}
        playerVariant={isMobile ? 'native' : 'controlled'}
        poster={data.resultVideoThumbnail}
        project={data.previewProject}
        projectId={projectId}
        ratio={data.ratio}
        script={data.script}
        shareMode
        shouldShowProcessingPreview={!data.videoUrl}
        showUserPrompt
        sourceBgmEnabled={data.bgmEnabled}
        sourceVoice={data.sourceVoice}
        stage={data.stage}
        stageDetail={data.stageDetail}
        stageStatus={data.stageStatus}
        styleName={data.styleName}
        styleText={data.styleText}
        styleThumbnailUrl={data.styleThumbnailUrl}
        templateAudioUrl={detailTemplateAudioUrl}
        topOverlay={topOverlay}
        videoAspectRatio={data.previewAspectRatio}
        videoUrl={data.videoUrl}
        watermarkVideoUrl={data.watermarkVideoUrl}
      />
      <StoryModeAssetPreviewDialog asset={previewAsset} onClose={() => setPreviewAsset(null)} />
    </div>
  )
}
