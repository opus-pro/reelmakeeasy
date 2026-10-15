import type {
  EmbeddedVideoPlanBlock as EmbeddedVideoPlanBlockType,
  VideoPlanDocReference,
  VideoPlanImageReference,
  VideoPlanLinkReference,
} from '@shared/types/chat/message-embedded-block'
import { cn, Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  Caption,
  Clock,
  File,
  Link as LinkIcon,
  Microphone,
  Pause,
  PlayCircle,
  QuestionLoading,
  User,
} from '@/components/icons/core'

/**
 * Media Preview Item - Handles video playback on click
 */
export function MediaPreviewItem({
  className,
  extraCount = 0,
  iconSize = 'size-8',
  mediaRef,
  showExtraCount = false,
}: {
  className?: string
  extraCount?: number
  iconSize?: string
  mediaRef: VideoPlanImageReference
  showExtraCount?: boolean
}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (mediaRef.type === 'video' && videoRef.current) {
        if (isPlaying) {
          videoRef.current.pause()
          setIsPlaying(false)
        } else {
          videoRef.current.play()
          setIsPlaying(true)
        }
      }
    },
    [mediaRef.type, isPlaying],
  )

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false)
  }, [])

  return (
    <div
      className={cn(
        'bg-secondary relative overflow-hidden rounded-xs',
        mediaRef.type === 'video' && 'cursor-pointer',
        className,
      )}
      onClick={handleClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {mediaRef.type === 'video' ? (
        <>
          <video
            className="size-full object-cover"
            onEnded={handleVideoEnded}
            playsInline
            poster={mediaRef.previewUrl}
            ref={videoRef}
            src={mediaRef.url}
          />
          {/* Show play button when not playing */}
          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <PlayCircle className={cn('text-primary', iconSize)} />
            </div>
          )}
          {/* Show pause button on hover when playing */}
          {isPlaying && isHovering && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <div className="flex items-center justify-center rounded-full bg-black/50">
                <Pause className="text-primary size-4" />
              </div>
            </div>
          )}
        </>
      ) : (
        mediaRef.previewUrl && (
          <img alt={mediaRef.title} className="size-full object-cover" src={mediaRef.previewUrl} />
        )
      )}
      {showExtraCount && extraCount > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <span className="text-white text-medium font-medium">+{extraCount}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Links and Files List - Reusable component for displaying links and files
 * maxItems is the total limit for links + files combined; when total > maxItems, bottom alpha mask is applied
 */
export function LinksAndFilesList({
  docReferences,
  linkReferences,
  maxItems = 3,
}: {
  docReferences: VideoPlanDocReference[]
  linkReferences: VideoPlanLinkReference[]
  maxItems?: number
}) {
  if (linkReferences.length === 0 && docReferences.length === 0) {
    return null
  }

  const linksToShow = linkReferences.slice(0, maxItems)
  const remainingSlots = maxItems - linksToShow.length
  const docsToShow = docReferences.slice(0, remainingSlots)
  const totalCount = linkReferences.length + docReferences.length
  const hasOverflow = totalCount > maxItems

  const listContent = (
    <div className="flex flex-col gap-2">
      {linksToShow.map((ref, idx) => (
        <div className="text-secondary flex items-start gap-2 text-sm" key={`link-${idx}`}>
          <div className="bg-fill-tertiary flex size-9 shrink-0 items-center justify-center rounded-xs">
            <LinkIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1 flex flex-col gap-0.5">
            <span className="text-primary truncate text-sm">{ref.title}</span>
            {ref.domain && <span className="text-tertiary truncate text-xs">{ref.domain}</span>}
          </div>
        </div>
      ))}
      {docsToShow.map((ref, idx) => (
        <div className="text-secondary flex items-start gap-2 text-sm" key={`doc-${idx}`}>
          <div className="bg-fill-tertiary flex size-9 shrink-0 items-center justify-center rounded-xs">
            <File className="size-4" />
          </div>
          <div className="min-w-0 flex-1 flex flex-col gap-0.5">
            <span className="text-primary truncate text-sm">{ref.title}</span>
            {ref.fileType && (
              <span className="text-tertiary truncate text-xs uppercase">{ref.fileType}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )

  if (hasOverflow) {
    return (
      <div className="relative overflow-hidden">
        <div
          className="max-h-[5.5rem] overflow-hidden"
          style={{
            maskImage: 'linear-gradient(to bottom, black 0%, black 75%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 75%, transparent 100%)',
          }}
        >
          {listContent}
        </div>
      </div>
    )
  }

  return listContent
}

/** Renders Reference card body (skeleton, assets+links, links-only, keywords, or empty) */
export function ReferenceSectionBody({
  docReferences,
  displayMedia,
  extraCount,
  isLoading,
  keywordReferences,
  linkReferences,
  mediaReferences,
}: {
  displayMedia: VideoPlanImageReference[]
  docReferences: VideoPlanDocReference[]
  extraCount: number
  isLoading: boolean
  keywordReferences: string[]
  linkReferences: VideoPlanLinkReference[]
  mediaReferences: VideoPlanImageReference[]
  references: EmbeddedVideoPlanBlockType['content']['data']['references']
}) {
  const hasReferences = Boolean(
    mediaReferences.length || linkReferences.length || docReferences.length,
  )
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((idx) => (
            <div className="bg-fill-tertiary aspect-[3/2] rounded-xs" key={idx} />
          ))}
        </div>
        <div className="flex flex-col gap-1 py-1">
          {[1, 2].map((idx) => (
            <div className="flex items-center gap-2.5 py-1" key={idx}>
              <div className="bg-fill-tertiary size-9 shrink-0 rounded-xs" />
              <div className="flex flex-1 flex-col gap-1">
                <div className="bg-fill-tertiary h-3 w-48 rounded-xs" />
                <div className="bg-fill-tertiary h-3 w-32 rounded-xs" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (hasReferences && displayMedia.length > 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          {displayMedia.map((ref, idx) => (
            <MediaPreviewItem
              className="aspect-[3/2]"
              extraCount={extraCount}
              key={idx}
              mediaRef={ref}
              showExtraCount={idx === displayMedia.length - 1 && extraCount > 0}
            />
          ))}
        </div>
        <LinksAndFilesList
          docReferences={docReferences}
          linkReferences={linkReferences}
          maxItems={2}
        />
      </div>
    )
  }
  if (hasReferences && (linkReferences.length > 0 || docReferences.length > 0)) {
    return (
      <LinksAndFilesList
        docReferences={docReferences}
        linkReferences={linkReferences}
        maxItems={2}
      />
    )
  }
  if (keywordReferences.length > 0) {
    return (
      <div className="flex flex-wrap gap-2">
        {keywordReferences.map((keyword, idx) => (
          <span
            className="rounded-xs bg-fill-secondary px-2 py-1.5 text-primary text-xs font-medium leading-none"
            key={`keyword-${idx}`}
          >
            {keyword}
          </span>
        ))}
      </div>
    )
  }
  return (
    <div className="bg-secondary/50 flex h-24 items-center justify-center rounded-md border border-dashed border-secondary">
      <span className="text-tertiary text-xs">No reference materials</span>
    </div>
  )
}

/**
 * Reference Section - Separate card for references
 * Loading state is determined by whether references data exists
 */
export function ReferenceSection({
  data,
}: {
  data?: EmbeddedVideoPlanBlockType['content']['data']
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const references = data?.references
  const mediaReferences = references?.images || []
  const linkReferences = references?.links || []
  const docReferences = references?.docs || []
  const keywordReferences = references?.keywords || []
  const hasDialogContent = Boolean(
    mediaReferences.length || linkReferences.length || docReferences.length,
  )
  const displayMedia = mediaReferences.slice(0, 3)
  const extraCount = mediaReferences.length > 3 ? mediaReferences.length - 3 : 0
  const isLoading = references === undefined

  const openDialog = useCallback(() => {
    if (hasDialogContent) {
      setDialogOpen(true)
    }
  }, [hasDialogContent])

  return (
    <div
      className={cn('flex flex-col gap-4', hasDialogContent && 'cursor-pointer')}
      onClick={hasDialogContent ? openDialog : undefined}
      onKeyDown={
        hasDialogContent
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openDialog()
              }
            }
          : undefined
      }
      role={hasDialogContent ? 'button' : undefined}
      tabIndex={hasDialogContent ? 0 : undefined}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-primary text-lg font-semibold">Reference</h4>
        {!isLoading && hasDialogContent && (
          <span
            className="text-secondary hover:text-primary text-sm transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              setDialogOpen(true)
            }}
          >
            More
          </span>
        )}
      </div>

      <ReferenceDialog
        docReferences={docReferences}
        linkReferences={linkReferences}
        mediaReferences={mediaReferences}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
      />

      <ReferenceSectionBody
        displayMedia={displayMedia}
        docReferences={docReferences}
        extraCount={extraCount}
        isLoading={isLoading}
        keywordReferences={keywordReferences}
        linkReferences={linkReferences}
        mediaReferences={mediaReferences}
        references={references}
      />
    </div>
  )
}

/**
 * Reference Dialog - Shows all references in a tabbed dialog
 */
export function ReferenceDialog({
  docReferences,
  linkReferences,
  mediaReferences,
  onOpenChange,
  open,
}: {
  docReferences: VideoPlanDocReference[]
  linkReferences: VideoPlanLinkReference[]
  mediaReferences: VideoPlanImageReference[]
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  // Determine default tab based on available content
  const defaultTab = useMemo(() => {
    if (mediaReferences.length > 0) {
      return 'assets'
    }
    if (linkReferences.length > 0) {
      return 'links'
    }
    if (docReferences.length > 0) {
      return 'files'
    }
    return 'assets'
  }, [mediaReferences.length, linkReferences.length, docReferences.length])

  const handleOpenUrl = (url?: string) => {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <Dialog
      classNames={{
        content: 'bg-[#272727] border-none max-w-[560px] p-6',
        header: 'pb-4',
        title: 'text-primary text-xl font-semibold',
      }}
      footer={null}
      onOpenChange={onOpenChange}
      open={open}
      title="Reference"
    >
      <Tabs className="flex h-[400px] w-full flex-col" defaultValue={defaultTab}>
        <TabsList className="bg-transparent h-auto shrink-0 gap-4 justify-start p-0 mb-4 border-b border-white/10 w-full rounded-none">
          <TabsTrigger
            className="text-secondary data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-white rounded-none bg-[#272727] px-0 pb-2 text-sm font-medium data-[state=active]:shadow-none data-[state=active]:bg-[#272727]"
            value="assets"
          >
            Assets
          </TabsTrigger>
          <TabsTrigger
            className="text-secondary data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-white rounded-none bg-[#272727] px-0 pb-2 text-sm font-medium data-[state=active]:shadow-none data-[state=active]:bg-[#272727]"
            value="links"
          >
            Links
          </TabsTrigger>
          <TabsTrigger
            className="text-secondary data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-white rounded-none bg-[#272727] px-0 pb-2 text-sm font-medium data-[state=active]:shadow-none data-[state=active]:bg-[#272727]"
            value="files"
          >
            Files
          </TabsTrigger>
        </TabsList>

        {/* Assets Tab */}
        <TabsContent className="mt-0 flex-1 overflow-y-auto" value="assets">
          {mediaReferences.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {mediaReferences.map((ref, idx) => (
                <MediaPreviewItem
                  className="aspect-[3/2]"
                  iconSize="size-8"
                  key={idx}
                  mediaRef={ref}
                />
              ))}
            </div>
          ) : (
            <div className="text-tertiary py-8 text-center text-sm">No assets</div>
          )}
        </TabsContent>

        {/* Links Tab */}
        <TabsContent className="mt-0 flex-1 overflow-y-auto" value="links">
          {linkReferences.length > 0 ? (
            <div className="flex flex-col gap-1">
              {linkReferences.map((ref, idx) => (
                <button
                  className="flex items-center w-[500px] gap-2.5 py-2 text-left transition-opacity hover:opacity-80"
                  key={idx}
                  onClick={() => handleOpenUrl(ref.url)}
                  type="button"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white/[0.08]">
                    <LinkIcon className="text-secondary size-[18px]" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <span className="text-primary truncate text-sm leading-[22px] ">
                      {ref.title}
                    </span>
                    {ref.domain && (
                      <span className="text-secondary truncate text-xs leading-[19px]">
                        {ref.domain}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-tertiary py-8 text-center text-sm">No links</div>
          )}
        </TabsContent>

        {/* Files Tab */}
        <TabsContent className="mt-0 flex-1 overflow-y-auto" value="files">
          {docReferences.length > 0 ? (
            <div className="flex flex-col">
              {docReferences.map((ref, idx) => (
                <button
                  className="flex w-[500px] items-center gap-2.5 py-1 text-left transition-opacity hover:opacity-80"
                  key={idx}
                  onClick={() => handleOpenUrl(ref.url)}
                  type="button"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white/[0.08]">
                    <File className="text-secondary size-[18px]" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <span className="text-primary truncate text-sm leading-[22px]">
                      {ref.title}
                    </span>
                    {ref.fileType && (
                      <span className="text-secondary text-xs uppercase leading-[19px]">
                        {ref.fileType}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-tertiary py-8 text-center text-sm">No files</div>
          )}
        </TabsContent>
      </Tabs>
    </Dialog>
  )
}

/**
 * Transcript Preview - Right Card
 * Handles partial data gracefully (transcript may arrive later)
 */
export function TranscriptPreview({
  data,
}: {
  data?: EmbeddedVideoPlanBlockType['content']['data']
}) {
  const transcript = data?.transcript
  const [countdown, setCountdown] = useState(30)
  const countdownStartedRef = useRef(false)
  const [contentVisible, setContentVisible] = useState(false)

  // Loading state is determined by whether transcript data exists
  const isLoading = !transcript

  // Countdown timer for loading state
  useEffect(() => {
    if (isLoading && !countdownStartedRef.current) {
      countdownStartedRef.current = true
      const startTime = Date.now()

      const timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        const remaining = Math.max(0, 30 - elapsed)
        setCountdown(remaining)

        if (remaining <= 0) {
          clearInterval(timer)
        }
      }, 1000)

      return () => clearInterval(timer)
    }
  }, [isLoading])

  // Fade in transcript content + edit button when transcript is ready (after loading)
  useEffect(() => {
    if (!transcript) {
      return
    }
    const id = requestAnimationFrame(() => setContentVisible(true))
    return () => cancelAnimationFrame(id)
  }, [transcript])

  const durationText = useMemo(() => {
    if (!transcript?.estimatedDurationSeconds) {
      return null
    }
    if (Array.isArray(transcript.estimatedDurationSeconds)) {
      return `${transcript.estimatedDurationSeconds[0]}-${transcript.estimatedDurationSeconds[1]} Seconds`
    }
    return `${transcript.estimatedDurationSeconds} Seconds`
  }, [transcript?.estimatedDurationSeconds])

  // Show loading state if transcript not yet available
  if (isLoading) {
    // Skeleton rows using Tailwind tokens (closest values)
    const skeletonRows = (
      <>
        <div className="flex gap-1">
          <div className="bg-fill-tertiary h-4 w-11 rounded" />
          <div className="bg-fill-tertiary h-4 w-20 rounded" />
        </div>
        <div className="bg-fill-tertiary h-4 w-28 rounded" />
        <div className="flex gap-1">
          <div className="bg-fill-tertiary h-4 w-16 rounded" />
          <div className="bg-fill-tertiary h-4 w-20 rounded" />
        </div>
        <div className="bg-fill-tertiary h-4 w-40 rounded" />
        <div className="bg-fill-tertiary h-4 w-28 rounded" />
        <div className="flex gap-1">
          <div className="bg-fill-tertiary h-4 w-11 rounded" />
          <div className="bg-fill-tertiary h-4 w-20 rounded" />
        </div>
        <div className="bg-fill-tertiary h-4 w-28 rounded" />
        <div className="flex gap-1">
          <div className="bg-fill-tertiary h-4 w-14 rounded" />
          <div className="bg-fill-tertiary h-4 w-16 rounded" />
        </div>
        <div className="bg-fill-tertiary h-4 w-40 rounded" />
        <div className="bg-fill-tertiary h-4 w-28 rounded" />
      </>
    )
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        <style>
          {
            '@keyframes transcriptScroll { 0% { transform: translateY(0); } 100% { transform: translateY(-25%); } }'
          }
        </style>
        <h3 className="text-primary shrink-0 text-lg font-semibold">Transcript</h3>
        <div className="text-secondary flex shrink-0 items-center gap-1.5 text-sm">
          <QuestionLoading className="size-4.5 shrink-0 animate-spin" />
          <span>Researching the topic for your script... {countdown}s</span>
        </div>
        {/* Wrapper takes remaining space and centers the skeleton vertically */}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {/* Scrolling placeholder with reduced height (40%), top + bottom alpha mask */}
          <div
            className="relative flex h-2/5 w-full items-center justify-center overflow-hidden"
            style={{
              maskImage:
                'linear-gradient(to bottom, transparent 0%, black 40%, black 60%, transparent 100%)',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0%, black 40%, black 60%, transparent 100%)',
            }}
          >
            <div
              className="flex w-40 flex-col items-center gap-2"
              style={{ animation: 'transcriptScroll 12s linear infinite' }}
            >
              {/* Repeat rows 4x for seamless infinite scroll (translateY -25% loops one set) */}
              {skeletonRows}
              {skeletonRows}
              {skeletonRows}
              {skeletonRows}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <h3 className="text-primary shrink-0 text-lg font-semibold">Transcript</h3>

      {/* Meta row: word count (Caption icon), duration, voice, avatar */}
      <div className="text-secondary flex shrink-0 flex-wrap items-center gap-3 text-sm">
        {transcript.wordCount != null && (
          <span className="flex items-center gap-1.5">
            <Caption className="size-4 shrink-0" />
            {transcript.wordCount} Words
          </span>
        )}
        {durationText && (
          <span className="flex items-center gap-1.5">
            <Clock className="size-4" />
            {durationText}
          </span>
        )}
        {transcript.voiceName && (
          <span className="flex items-center gap-1.5">
            <Microphone className="size-4" />
            {transcript.voiceName}
          </span>
        )}
        {transcript.avatarName && (
          <span className="flex items-center gap-1.5">
            <User className="size-4" />
            {transcript.avatarName}
          </span>
        )}
      </div>

      {/* Content: alpha transition in when transcript is ready */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col transition-opacity duration-300',
          contentVisible ? 'opacity-100' : 'opacity-0',
        )}
      >
        {/* Content preview: primary text, adaptive height, bottom fade mask when overflow */}
        <div
          className="relative min-h-0 flex-1 overflow-hidden text-primary text-sm leading-relaxed"
          style={{
            maskImage: 'linear-gradient(to bottom, black 0%, black 80%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 80%, transparent 100%)',
          }}
        >
          {transcript.content || 'Generating script...'}
        </div>
      </div>
    </div>
  )
}
