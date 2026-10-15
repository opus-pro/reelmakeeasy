'use client'

import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import {
  Button,
  Carousel,
  CarouselContent,
  CarouselItem,
  cn,
  Dialog,
  useCarousel,
} from '@shared/ui'
import { atom, useSetAtom } from 'jotai'
import { useSearchParams } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ProjectNavOverlay } from '@/app/story-mode/components/LongTakeViewer/ProjectNavOverlay'
import { QUICK_START_TEMPLATE_QUERY_KEY } from '@/app/story-mode/navigation'
import { type ApplyQuickStartTemplatePayload, quickStartDeepLinkTemplateAtom } from '@/atom/home'
import { dialogVideoMutedAtom } from '@/atom/ui'
import { Cross } from '@/components/icons/core'
import { ProjectThumbnailStrip, type ThumbnailItem } from '@/components/ProjectThumbnailStrip'
import { useGlobalFloatingNotificationSlotHidden } from '@/hooks/useGlobalFloatingNotificationSlotHidden'
import { useIsMobile } from '@/util/browserUtils'

import { QuickStartTemplateCarouselItem } from './QuickStartTemplateCarouselItem'
import { MobileDetailPanel, QuickStartTemplateDetail } from './QuickStartTemplateDetailPanels'
import {
  AspectRatioSyncWrapper,
  CarouselControlsWrapper,
  DemoNavigationTracker,
  TemplateQuerySyncWrapper,
} from './QuickStartTemplateDialogCarouselSync'
import {
  aspectRatioToWidthHeight,
  useDialogKeyboard,
  useDisplayList,
  useVideoDimensions,
} from './QuickStartTemplateDialogHooks'
import type {
  QuickStartVideoMetadata,
  QuickStartVideoMetadataMap,
} from './QuickStartTemplateDialogTypes'

type QuickStartTemplateDialogProps = {
  initialIndex: number
  onClose?: () => void
  onRecreate: (template: QuickStartTemplate, payload: ApplyQuickStartTemplatePayload) => void
  onTemplateChange?: (template: QuickStartTemplate) => void
  open: boolean
  templates?: QuickStartTemplate[]
  urlPattern?: 'path' | 'query'
}

export const QuickStartTemplateDialog: React.FC<QuickStartTemplateDialogProps> = ({
  initialIndex,
  open,
  onClose,
  onRecreate,
  onTemplateChange,
  urlPattern = 'query',
  templates,
}) => {
  const setDeepLinkTemplate = useSetAtom(quickStartDeepLinkTemplateAtom)
  const setDialogVideoMuted = useSetAtom(dialogVideoMutedAtom)
  const carouselRef = useRef<null | { scrollNext: () => void; scrollPrev: () => void }>(null)
  const dialogContentRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()

  const isMobile = useIsMobile()
  const displayList = useDisplayList(templates)
  const [currentAspectRatio, setCurrentAspectRatio] = useState<'1:1' | '9:16' | '16:9' | undefined>(
    displayList[initialIndex]?.aspectRatio,
  )
  const { widthRatio, heightRatio } = aspectRatioToWidthHeight(currentAspectRatio)
  const { videoWidth, videoHeight, videoPaneRef } = useVideoDimensions(widthRatio, heightRatio, 400)
  const hasQuickStartTemplateQuery = Boolean(searchParams?.get(QUICK_START_TEMPLATE_QUERY_KEY))
  const shouldHideGlobalFloatingNotificationSlot = open || hasQuickStartTemplateQuery
  useGlobalFloatingNotificationSlotHidden(shouldHideGlobalFloatingNotificationSlot, {
    scope: 'quick-start-template-dialog',
  })

  const handleClose = useCallback(() => {
    setDeepLinkTemplate(null)
    setDialogVideoMuted(false)
    onClose?.()
  }, [onClose, setDeepLinkTemplate, setDialogVideoMuted])

  // Reset mute when dialog closes via prop (early-return path bypasses handleClose).
  useEffect(() => {
    if (!open) {
      setDialogVideoMuted(false)
    }
  }, [open, setDialogVideoMuted])

  useDialogKeyboard(open, carouselRef, dialogContentRef, handleClose)

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        handleClose()
      }
    },
    [handleClose],
  )

  if (!open) {
    return null
  }

  return (
    <Dialog
      classNames={{
        content: cn(
          'z-[91] max-w-[100dvw] min-w-[100dvw] w-[100dvw] h-[100dvh] min-h-[100dvh] !rounded-none sm:!rounded-none border-0 p-0 gap-0 box-border overflow-hidden',
          'bg-black/90 backdrop-blur-3xl',
        ),
        overlay: 'z-[90]',
      }}
      footer={null}
      header={null}
      ignoreInteractOutside
      onOpenChange={handleOpenChange}
      open={open}
      showClose={false}
    >
      <div
        className="h-dvh w-dvw min-h-0 min-w-0 flex flex-col overflow-hidden outline-none"
        ref={dialogContentRef}
        tabIndex={-1}
      >
        {displayList.length ? (
          <>
            <div className="min-h-0 w-full flex-1">
              <DialogCarouselBody
                carouselRef={carouselRef}
                displayList={displayList}
                handleClose={handleClose}
                initialIndex={initialIndex}
                isMobile={isMobile}
                onAspectRatioChange={setCurrentAspectRatio}
                onRecreate={onRecreate}
                onTemplateChange={onTemplateChange}
                urlPattern={urlPattern}
                videoHeight={videoHeight}
                videoPaneRef={videoPaneRef}
                videoWidth={videoWidth}
              />
            </div>
          </>
        ) : (
          <div className="text-secondary text-lg">Loading...</div>
        )}
      </div>
    </Dialog>
  )
}

type DialogCarouselBodyProps = {
  carouselRef: React.MutableRefObject<null | { scrollNext: () => void; scrollPrev: () => void }>
  displayList: QuickStartTemplate[]
  handleClose: () => void
  initialIndex: number
  isMobile: boolean
  onAspectRatioChange: (ratio: '1:1' | '9:16' | '16:9' | undefined) => void
  onRecreate: (template: QuickStartTemplate, payload: ApplyQuickStartTemplatePayload) => void
  onTemplateChange?: (template: QuickStartTemplate) => void
  urlPattern: 'path' | 'query'
  videoHeight: number | undefined
  videoPaneRef: (el: HTMLDivElement | null) => void
  videoWidth: number | undefined
}

const DialogCarouselBody: React.FC<DialogCarouselBodyProps> = ({
  carouselRef,
  displayList,
  handleClose,
  initialIndex,
  isMobile,
  onAspectRatioChange,
  onRecreate,
  onTemplateChange,
  urlPattern,
  videoHeight,
  videoPaneRef,
  videoWidth,
}) => {
  const videoMetadataAtom = useMemo(
    () => atom<QuickStartVideoMetadataMap>(new Map<string, QuickStartVideoMetadata>()),
    [],
  )

  // The detail row spans the full pane height (not the video's height) so the
  // side panel keeps a consistent height across aspect ratios -- a landscape
  // video no longer shrinks the panel. The video itself stays sized
  // by videoContainerStyle and centered within the row.
  const videoPaneStyle = useMemo(
    () => (isMobile ? {} : { height: '100%', minHeight: 0 }),
    [isMobile],
  )

  const videoContainerStyle = useMemo(() => {
    if (!isMobile && videoWidth && videoHeight) {
      return { width: `${videoWidth}px`, height: `${videoHeight}px` }
    }
    if (isMobile) {
      return {}
    }
    return { maxWidth: '100%', maxHeight: '100%' }
  }, [isMobile, videoWidth, videoHeight])

  const carouselOpts = useMemo(
    () => ({
      startIndex: Math.min(initialIndex, Math.max(0, displayList.length - 1)),
      watchDrag: (_: unknown, evt: MouseEvent | TouchEvent) => {
        const target = evt.target
        return !(target instanceof Element && target.closest('[data-no-carousel-drag]'))
      },
    }),
    [initialIndex, displayList.length],
  )

  return (
    <Carousel
      className={cn(
        'size-full min-h-0 min-w-0 flex justify-center items-center overflow-hidden',
        isMobile && 'flex-col',
      )}
      opts={carouselOpts}
    >
      <CarouselControlsWrapper carouselRef={carouselRef} />
      <TemplateQuerySyncWrapper templates={displayList} urlPattern={urlPattern} />
      <AspectRatioSyncWrapper onAspectRatioChange={onAspectRatioChange} templates={displayList} />
      <DemoNavigationTracker templates={displayList} />
      <Button
        aria-label="Close dialog"
        className="fixed right-4 top-4 z-50 rounded-full lg:left-6 lg:right-auto lg:top-6"
        onClick={handleClose}
        size="icon"
      >
        <Cross className="size-3.5 text-primary sm:size-4" />
      </Button>
      <div className="hidden sm:contents">
        <CarouselNavOverlay onTemplateChange={onTemplateChange} templates={displayList} />
      </div>
      <div
        className={cn(
          'flex-1 self-stretch min-h-0 min-w-0 inline-flex flex-col justify-center items-center gap-2.5 overflow-hidden',
          isMobile
            ? 'absolute top-16 bottom-[20%] inset-x-0 pb-2'
            : 'm-4 sm:m-6 md:m-8 lg:m-[50px]',
        )}
        ref={videoPaneRef}
      >
        <div
          className={cn(
            isMobile
              ? 'inline-flex justify-center items-center gap-4 md:gap-8 lg:gap-12 h-full min-h-0'
              : 'w-full min-h-0 inline-flex justify-between items-stretch gap-4 md:gap-8 lg:gap-12',
          )}
          style={videoPaneStyle}
        >
          <div
            className={cn(
              isMobile
                ? 'flex min-h-0 justify-center items-center h-full flex-1'
                : 'flex-1 min-h-0 self-stretch flex justify-center items-center',
            )}
          >
            <div
              className={cn(
                'rounded-2xl overflow-hidden flex-shrink-0 min-h-0 max-h-full',
                isMobile && 'w-full h-full flex items-center justify-center',
              )}
              style={videoContainerStyle}
            >
              <CarouselContent
                className={cn('h-full min-h-0', isMobile && 'ml-0')}
                wrapperClassName={cn('h-full min-h-0 relative', isMobile && 'flex items-center')}
              >
                {displayList.map((temp, idx) => (
                  <CarouselItem
                    className={cn(
                      'flex flex-col items-center justify-center h-full',
                      isMobile && 'justify-center pl-0',
                    )}
                    key={temp.projectId}
                  >
                    <QuickStartTemplateCarouselItem idx={idx} isMobile={isMobile} template={temp} />
                  </CarouselItem>
                ))}
              </CarouselContent>
            </div>
          </div>
          {!isMobile && (
            <QuickStartTemplateDetail
              onRecreate={onRecreate}
              templates={displayList}
              videoHeight={videoHeight}
              videoMetadataAtom={videoMetadataAtom}
            />
          )}
        </div>
      </div>
      {isMobile && (
        <MobileDetailPanel
          onRecreate={onRecreate}
          templates={displayList}
          videoMetadataAtom={videoMetadataAtom}
        />
      )}
      <div className="max-sm:hidden self-stretch min-h-0 flex flex-col my-4">
        <CarouselThumbnailStrip onTemplateChange={onTemplateChange} templates={displayList} />
      </div>
    </Carousel>
  )
}

const CarouselNavOverlay: React.FC<{
  onTemplateChange?: (template: QuickStartTemplate) => void
  templates: QuickStartTemplate[]
}> = ({ onTemplateChange, templates }) => {
  const { canScrollPrev, canScrollNext, scrollPrev, scrollNext, selectedIndex } = useCarousel()
  return (
    <ProjectNavOverlay
      hasNext={canScrollNext}
      hasPrev={canScrollPrev}
      onNext={() => {
        const next = templates[selectedIndex + 1]
        if (next) {
          onTemplateChange?.(next)
        }
        scrollNext()
      }}
      onPrev={() => {
        const prev = templates[selectedIndex - 1]
        if (prev) {
          onTemplateChange?.(prev)
        }
        scrollPrev()
      }}
    />
  )
}

const CarouselThumbnailStrip: React.FC<{
  onTemplateChange?: (template: QuickStartTemplate) => void
  orientation?: 'horizontal' | 'vertical'
  templates: QuickStartTemplate[]
}> = ({ onTemplateChange, orientation, templates }) => {
  const { selectedIndex, scrollTo } = useCarousel()
  const items = useMemo<ThumbnailItem[]>(
    () =>
      templates.map((template) => ({
        id: template.projectId,
        thumbnailUrl: template.thumbnail,
        title: template.title,
      })),
    [templates],
  )
  return (
    <ProjectThumbnailStrip
      items={items}
      onSelect={(_id, index) => {
        const template = templates[index]
        if (template) {
          onTemplateChange?.(template)
        }
        scrollTo(index)
      }}
      orientation={orientation}
      selectedId={templates[selectedIndex]?.projectId}
    />
  )
}
