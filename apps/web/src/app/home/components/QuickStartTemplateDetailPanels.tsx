'use client'
import type { QuickStartTemplate, QuickStartTemplateAsset } from '@shared/types/assets/quick-start'
import { Badge, Button, cn, useCarousel } from '@shared/ui'
import { useSetAtom } from 'jotai'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import React, { useCallback, useRef, useState } from 'react'

import { isStoryModeQuickStartTemplate } from '@/app/home/hooks/quick-start-template-utils'
import { type ApplyQuickStartTemplatePayload, quickStartDeepLinkTemplateAtom } from '@/atom/home'
import { extractAttachmentsFromText } from '@/components/markdown-editor/custom-nodes/MetaTagNode'
import { useSearchByProjectId } from '@/hooks/useShareProject'
import { templateAssetsToAttachments } from '@/util/template-asset-attachments'

import { useHydratedDemoTemplate } from '../hooks/useHydratedDemoTemplate'

import type { QuickStartVideoMetadataAtom } from './QuickStartTemplateDialogTypes'
import { StoryModeTemplateDetail } from './QuickStartTemplateStoryModeDetail'

const isStoryModeTemplate = (template: QuickStartTemplate) =>
  isStoryModeQuickStartTemplate(template)

const AssetThumbnail: React.FC<{
  asset: QuickStartTemplateAsset
}> = ({ asset }) => {
  const isVideo = asset.mimeType.startsWith('video/')

  return (
    <div className="size-10 relative rounded-lg overflow-hidden">
      {isVideo ? (
        <video
          className="size-full object-cover"
          muted
          onContextMenu={(e) => e.preventDefault()}
          preload="metadata"
          src={asset.url}
        />
      ) : (
        <Image alt={asset.name} className="object-cover" fill src={asset.url} />
      )}
    </div>
  )
}

// Renders the body of the QuickStart detail panel: title, prompt, assets,
// tags, optional transcript (S2V).
// Returns a fragment so the caller's flex-col wrapper supplies the gap
// between sections (desktop card uses gap-5, mobile drawer uses gap-5).
const TemplateDetailContent: React.FC<{
  clampPrompt?: boolean
  template: QuickStartTemplate
}> = ({ clampPrompt, template: cardTemplate }) => {
  const template = useHydratedDemoTemplate(cardTemplate)
  // Transcript renders whether it lives in the top-level field or nested meta.
  const transcript = template.transcript || template.s2vLandingPageMeta?.transcript
  return (
    <>
      <div className="self-stretch flex flex-col justify-start items-start gap-4">
        {template.title && (
          <div className="self-stretch text-white text-lg font-semibold leading-5">
            {template.title}
          </div>
        )}
        <div className="self-stretch inline-flex justify-start items-start gap-1.5">
          <div
            className={cn(
              'flex-1 text-white text-sm font-normal leading-5',
              clampPrompt && 'line-clamp-3',
            )}
          >
            {template.initPrompt}
          </div>
        </div>
      </div>

      {template.assets && template.assets.length > 0 && (
        <div className="self-stretch inline-flex items-start gap-2 flex-wrap place-content-start">
          {template.assets.map((asset) => (
            <AssetThumbnail asset={asset} key={asset.url} />
          ))}
        </div>
      )}

      <div className="self-stretch inline-flex justify-start items-center gap-2 flex-wrap content-center">
        {template.inputType && (
          <Badge
            className="h-5 px-1.5 bg-white/10 rounded-md text-xs font-medium"
            variant="secondary"
          >
            {template.inputType}
          </Badge>
        )}
        {template.useCases.map((tag) => (
          <Badge
            className="h-5 px-1.5 bg-white/10 rounded-md text-xs font-medium"
            key={tag}
            variant="secondary"
          >
            {tag}
          </Badge>
        ))}
      </div>

      {transcript && (
        <div className="self-stretch flex flex-col justify-start items-start gap-1.5">
          <div className="self-stretch text-white/50 text-sm font-normal uppercase leading-5">
            Transcript
          </div>
          <div className="self-stretch text-white text-sm font-normal leading-5">{transcript}</div>
        </div>
      )}
    </>
  )
}

const useTemplateRecreate = (
  template: QuickStartTemplate,
  onRecreate: (template: QuickStartTemplate, payload: ApplyQuickStartTemplatePayload) => void,
) => {
  const setDeepLinkTemplate = useSetAtom(quickStartDeepLinkTemplateAtom)

  const { sharedProjectId, isPending: isLoadingShareId } = useSearchByProjectId(
    template.projectType === 'S2V' ? template.projectId : '',
  )

  const handleRecreate = useCallback(() => {
    setDeepLinkTemplate(null)

    let templateAttachments = templateAssetsToAttachments(
      (template.assets ?? []).filter(
        (asset) => asset.mimeType.startsWith('image/') || asset.mimeType.startsWith('video/'),
      ),
    )

    if (templateAttachments.length === 0 && template.initPrompt) {
      templateAttachments = extractAttachmentsFromText(template.initPrompt)
    }

    const payload: ApplyQuickStartTemplatePayload = {
      prompt: template.initPrompt || '',
      attachments: templateAttachments,
    }

    onRecreate(template, payload)

    // Exclude sourceUserId -- a real user identifier -- from the event payload;
    // everything else on QuickStartTemplate is demo/project metadata, not PII.
    const { sourceUserId: _sourceUserId, ...templateForAnalytics } = template
  }, [setDeepLinkTemplate, onRecreate, template])

  return { handleRecreate, sharedProjectId, isLoadingShareId }
}

export const QuickStartTemplateDetail: React.FC<{
  onRecreate: (template: QuickStartTemplate, payload: ApplyQuickStartTemplatePayload) => void
  templates: QuickStartTemplate[]
  videoHeight?: number
  videoMetadataAtom: QuickStartVideoMetadataAtom
}> = ({ templates, videoHeight, onRecreate, videoMetadataAtom }) => {
  const { selectedIndex } = useCarousel()
  const template = templates[selectedIndex]

  if (isStoryModeTemplate(template)) {
    return (
      <StoryModeTemplateDetail
        template={template}
        videoHeight={videoHeight}
        videoMetadataAtom={videoMetadataAtom}
      />
    )
  }

  return <RecreateTemplateDetail onRecreate={onRecreate} template={template} />
}

// The recreate-flow hooks live in this child so the parent can early-return
// the story-mode variant without changing its own rendered hook count when the
// carousel selection switches template kinds (React #310/#300).
// Keeping useTemplateRecreate out of the parent also keeps its share-id lookup
// scoped to non-story-mode templates.
const RecreateTemplateDetail: React.FC<{
  onRecreate: (template: QuickStartTemplate, payload: ApplyQuickStartTemplatePayload) => void
  template: QuickStartTemplate
}> = ({ onRecreate, template: cardTemplate }) => {
  const router = useRouter()
  // useTemplateRecreate builds the recreate payload from initPrompt, so it
  // needs the full record, not the card shape.
  const template = useHydratedDemoTemplate(cardTemplate)
  const { handleRecreate, sharedProjectId, isLoadingShareId } = useTemplateRecreate(
    template,
    onRecreate,
  )

  return (
    // Fill the video pane's full height rather than the video's own height, so a
    // landscape (16:9) template's short video doesn't cram the side panel -- the
    // panel keeps a consistent, comfortable height regardless of video aspect
    // ratio. Height comes from the flex row's items-stretch.
    <div className="inline-flex flex-col justify-start items-start gap-4 shrink-0 self-stretch min-h-0">
      {/* Top Card - Title, Prompt, Assets, Tags */}
      <div className="w-[280px] md:w-[320px] lg:w-[360px] xl:w-[400px] flex-1 min-h-0 px-4 lg:px-6 pt-4 lg:pt-6 bg-white/10 rounded-2xl flex flex-col justify-start items-start gap-6 lg:gap-8 overflow-hidden">
        <div className="self-stretch flex-1 min-h-0 flex flex-col justify-start items-start gap-5 overflow-y-auto scrollbar-hide">
          <TemplateDetailContent template={template} />
        </div>
      </div>

      {/* Bottom Card - Action Buttons */}
      <div className="w-[280px] md:w-[320px] lg:w-[360px] xl:w-[400px] p-4 lg:p-6 bg-white/10 rounded-2xl flex flex-col justify-start items-start gap-4 flex-shrink-0">
        <Button className="self-stretch h-9 rounded-sm" onClick={handleRecreate} variant="primary">
          Recreate this video
        </Button>
        {sharedProjectId && (
          <Button
            className="self-stretch h-9 bg-white/10 rounded-sm"
            disabled={isLoadingShareId}
            onClick={() => router.push(`/share/${sharedProjectId}`)}
            variant="secondary"
          >
            See project
          </Button>
        )}
      </div>
    </div>
  )
}

export const MobileDetailPanel: React.FC<{
  onRecreate: (template: QuickStartTemplate, payload: ApplyQuickStartTemplatePayload) => void
  templates: QuickStartTemplate[]
  videoMetadataAtom: QuickStartVideoMetadataAtom
}> = ({ onRecreate, templates, videoMetadataAtom }) => {
  const { selectedIndex } = useCarousel()
  const template = templates[selectedIndex]
  const isStoryMode = isStoryModeTemplate(template)
  const [isExpanded, setIsExpanded] = useState(false)
  const dragStartY = useRef<null | number>(null)

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStartY.current = e.clientY
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragStartY.current === null) {
      return
    }
    const delta = dragStartY.current - e.clientY
    if (Math.abs(delta) < 10) {
      setIsExpanded((prev) => !prev)
    } else if (delta > 30) {
      setIsExpanded(true)
    } else if (delta < -30) {
      setIsExpanded(false)
    }
    dragStartY.current = null
  }

  const handlePointerCancel = () => {
    dragStartY.current = null
  }

  if (isStoryMode) {
    const collapsedHeight = 'max-h-[20%]'
    const expandedHeight = 'h-[75%]'

    return (
      <div
        className={cn(
          'absolute bottom-0 inset-x-0 bg-neutral-800 rounded-t-[10px] flex flex-col justify-start items-start transition-all duration-300 ease-out overflow-hidden',
          isExpanded ? expandedHeight : collapsedHeight,
        )}
        // Prevent Embla carousel from intercepting pointer events when panel is
        // expanded so that vertical scroll in the content area works on mobile.
        onPointerDown={isExpanded ? (e) => e.stopPropagation() : undefined}
      >
        <div
          className="self-stretch flex justify-center items-center py-6 cursor-pointer touch-none"
          onPointerCancel={handlePointerCancel}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          <div className="w-10 h-1 bg-white/30 rounded-full" />
        </div>
        <div
          className={cn(
            'self-stretch flex-1 p-4',
            isExpanded ? 'overflow-y-auto scrollbar-thin' : 'overflow-hidden',
          )}
        >
          <StoryModeTemplateDetail
            isMobile
            template={template}
            videoMetadataAtom={videoMetadataAtom}
          />
        </div>
      </div>
    )
  }

  return (
    <MobileRecreatePanel
      isExpanded={isExpanded}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onRecreate={onRecreate}
      template={template}
    />
  )
}

// See RecreateTemplateDetail: hooks for the recreate flow are isolated in this
// child so MobileDetailPanel's hook count stays constant across the
// story-mode / non-story-mode branch. The expand/drag state stays
// in the parent so it survives carousel switches between template kinds.
const MobileRecreatePanel: React.FC<{
  isExpanded: boolean
  onPointerCancel: () => void
  onPointerDown: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onRecreate: (template: QuickStartTemplate, payload: ApplyQuickStartTemplatePayload) => void
  template: QuickStartTemplate
}> = ({
  isExpanded,
  onPointerCancel,
  onPointerDown,
  onPointerUp,
  onRecreate,
  template: cardTemplate,
}) => {
  const router = useRouter()
  // Mirrors RecreateTemplateDetail: useTemplateRecreate builds the payload
  // prompt from initPrompt, which the card projection empties.
  const template = useHydratedDemoTemplate(cardTemplate)
  const { handleRecreate, sharedProjectId, isLoadingShareId } = useTemplateRecreate(
    template,
    onRecreate,
  )

  const collapsedHeight = 'h-[20%]'
  const expandedHeight = 'h-[75%]'

  return (
    <div
      className={cn(
        'absolute bottom-0 inset-x-0 bg-neutral-800 rounded-t-[10px] flex flex-col justify-start items-start transition-all duration-300 ease-out overflow-hidden',
        isExpanded ? expandedHeight : collapsedHeight,
      )}
      // Prevent Embla carousel from intercepting pointer events when panel is
      // expanded so that vertical scroll in the content area works on mobile.
      onPointerDown={isExpanded ? (e) => e.stopPropagation() : undefined}
    >
      {/* Drag Handle */}
      <div
        className="self-stretch flex justify-center items-center py-3 cursor-pointer touch-none"
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <div className="w-10 h-1 bg-white/30 rounded-full" />
      </div>

      {/* Action Buttons Row */}
      <div className="self-stretch px-4 inline-flex justify-start items-start gap-4">
        <Button className="flex-1 h-9 rounded-sm" onClick={handleRecreate} variant="primary">
          Recreate this video
        </Button>
        {sharedProjectId && (
          <Button
            className="flex-1 h-9 bg-white/10 rounded-sm"
            disabled={isLoadingShareId}
            onClick={() => router.push(`/share/${sharedProjectId}`)}
            variant="secondary"
          >
            See project
          </Button>
        )}
      </div>

      {/* Scrollable Content */}
      <div
        className={cn(
          'self-stretch flex-1 p-4 flex flex-col justify-start items-start gap-5',
          isExpanded ? 'overflow-y-auto' : 'overflow-hidden',
        )}
      >
        <TemplateDetailContent clampPrompt={!isExpanded} template={template} />
      </div>
    </div>
  )
}
