'use client'

import { Position } from '@reelmakeeasy/common/types/video-script'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import { Button, cn, toast } from '@shared/ui'
import Dialog from '@shared/ui/dialog'
import { useAtomValue } from 'jotai'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { QuestionLoading } from '@/components/icons/core'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { getVideoMetadata } from '@/util/media'

import { useCurrentShotMedia } from '../../hooks/useCurrentShotMedia'
import { useShotUpdate } from '../../hooks/useShotUpdate'
import { TemplateSegmentDel } from '../../instances/template/segment'
import { renderMainEngineStore } from '../../render-engine-sdk'

const nsLogger = Logger.get('project.reframe-crop-dialog')

export type PendingImage =
  | null
  | { imageSource: File; type: 'upload' }
  | { imageSource: string; segment: TemplateSegmentDel; type: 'current' }
  | { imageSource: string; type: 'library' }

export type ReframeMode = 'position' | 'upload'

interface ReframeCropDialogProps {
  imageSource: File | null | string
  isLoading?: boolean
  mode?: ReframeMode
  onCancel: () => void
  onConfirm?: (position: Position) => void
  onPositionConfirm?: (position: Position) => void
  open: boolean
}

type ResizeHandle = 'ne' | 'nw' | 'se' | 'sw' | null

export function useReframe() {
  const currentTime = useAtomValue(renderMainEngineStore.currentTime) / 1000
  const { updateShotPosition } = useShotUpdate()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingImage, setPendingImage] = useState<PendingImage>(null)
  const [mode, setMode] = useState<ReframeMode>('upload')
  const [isProcessing, setIsProcessing] = useState(false)

  const currentShotMedia = useCurrentShotMedia()

  const canReframe = !!pendingImage || !!currentShotMedia

  const setPendingForUpload = useRefCallback((file: File) => {
    setPendingImage({ type: 'upload', imageSource: file })
    setMode('upload')
    setDialogOpen(true)
  })

  const setPendingForLibrary = useRefCallback((url: string) => {
    setPendingImage({ type: 'library', imageSource: url })
    setMode('upload')
    setDialogOpen(true)
  })

  const openReframe = useRefCallback(async () => {
    if (pendingImage) {
      setMode('upload')
      setDialogOpen(true)
      return
    }

    if (!currentShotMedia) {
      return
    }

    setMode('position')

    if (currentShotMedia.isVideo) {
      setDialogOpen(true)
      setIsProcessing(true)

      try {
        const segmentStartSec = currentShotMedia.segment.timeRange.timelineIn / 1000
        const relativeTime = currentTime - segmentStartSec

        const result = await getVideoMetadata(currentShotMedia.uri, {
          withThumbnail: true,
          thumbnailTime: Math.max(0, relativeTime),
        })

        if (result.metadata?.thumbnailUrl) {
          setPendingImage({
            type: 'current',
            imageSource: result.metadata.thumbnailUrl,
            segment: currentShotMedia.segment,
          })
        } else {
          toast.warning('Failed to extract video frame')
          setDialogOpen(false)
        }
      } catch (error) {
        const err = ensureError(error)
        toast.warning(err.message || 'Failed to extract video frame')
        setDialogOpen(false)
      } finally {
        setIsProcessing(false)
      }
    } else {
      setPendingImage({
        type: 'current',
        imageSource: currentShotMedia.previewUri,
        segment: currentShotMedia.segment,
      })
      setDialogOpen(true)
    }
  })

  const cancel = useRefCallback(() => {
    setPendingImage(null)
    setDialogOpen(false)
    setIsProcessing(false)
  })

  const confirmPosition = useRefCallback(async (position: Position) => {
    if (!pendingImage || pendingImage.type !== 'current') {
      return
    }

    setIsProcessing(true)
    try {
      await updateShotPosition(position, pendingImage.segment)
      toast.success('Shot reframed successfully')
    } catch (error) {
      const err = ensureError(error)
      toast.warning(err.message || 'Failed to update shot position')
    } finally {
      setPendingImage(null)
      setDialogOpen(false)
      setIsProcessing(false)
    }
  })

  return {
    // State
    dialogOpen,
    pendingImage,
    mode,
    isProcessing,
    canReframe,
    // Actions
    setPendingForUpload,
    setPendingForLibrary,
    openReframe,
    cancel,
    confirmPosition,
    clearPending: () => setPendingImage(null),
    closeDialog: () => setDialogOpen(false),
  }
}

const ASPECT_RATIO = 9 / 16 // Fixed 9:16 aspect ratio

export function ReframeCropDialog({
  imageSource,
  isLoading = false,
  mode = 'upload',
  onConfirm,
  onPositionConfirm,
  onCancel,
  open,
}: ReframeCropDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [imageUrl, setImageUrl] = useState<null | string>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })
  const [displayDimensions, setDisplayDimensions] = useState({ width: 0, height: 0 })
  const [cropBox, setCropBox] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [isDraggingBox, setIsDraggingBox] = useState(false)
  const [isResizing, setIsResizing] = useState<ResizeHandle>(null)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [initialCropBox, setInitialCropBox] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const objectUrlRef = useRef<null | string>(null)

  // Create and manage object URL lifecycle
  useEffect(() => {
    if (!imageSource || !open) {
      setImageUrl(null)
      return
    }

    // If imageSource is a string (URL), fetch and convert to blob URL
    if (typeof imageSource === 'string') {
      setImageLoaded(false)

      const abortController = new AbortController()

      fetch(imageSource, { signal: abortController.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`)
          }
          return response.blob()
        })
        .then((blob: Blob) => {
          // Only create URL if fetch wasn't aborted
          if (!abortController.signal.aborted) {
            objectUrlRef.current = URL.createObjectURL(blob)
            setImageUrl(objectUrlRef.current)
          }
        })
        .catch((error) => {
          // Ignore abort errors, only log real failures
          if (error.name !== 'AbortError') {
            nsLogger.error('Failed to load image from URL:', error)
          }
        })

      return () => {
        abortController.abort()
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current)
          objectUrlRef.current = null
        }
      }
    }
    // If imageSource is a File, create object URL directly
    objectUrlRef.current = URL.createObjectURL(imageSource)
    setImageUrl(objectUrlRef.current)

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
      setImageUrl(null)
    }
  }, [imageSource, open])

  // Get design system color from CSS variable
  const getDesignSystemColor = useCallback((cssVar: string): string => {
    if (typeof window === 'undefined') {
      return '#ffffff'
    }
    const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
    return value || '#ffffff'
  }, [])

  // Load image
  useEffect(() => {
    if (!imageUrl || !open) {
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      imageRef.current = img
      setImageDimensions({ width: img.width, height: img.height })

      // Calculate display dimensions to maximize canvas area
      const containerWidth = 512
      const containerHeight = 378

      // Calculate scales for both dimensions
      const scaleWidth = containerWidth / img.width
      const scaleHeight = containerHeight / img.height

      // Use the smaller scale to ensure image fits completely
      const scale = Math.min(scaleWidth, scaleHeight)

      const displayWidth = Math.floor(img.width * scale)
      const displayHeight = Math.floor(img.height * scale)

      setDisplayDimensions({ width: displayWidth, height: displayHeight })
      setImageLoaded(true)

      // Initialize crop box: 9:16 ratio
      // Crop box in image space (not display space)
      const cropHeightInImageSpace = img.height // Use full image height initially
      const cropWidthInImageSpace = cropHeightInImageSpace * ASPECT_RATIO // 9:16 ratio

      // Center horizontally
      const x = Math.max(0, (img.width - cropWidthInImageSpace) / 2)
      const y = 0 // Start from top

      // If crop width exceeds image width, scale down
      let finalCropWidth = cropWidthInImageSpace
      let finalCropHeight = cropHeightInImageSpace

      if (cropWidthInImageSpace > img.width) {
        finalCropWidth = img.width
        finalCropHeight = finalCropWidth / ASPECT_RATIO
      }

      setCropBox({ x, y, width: finalCropWidth, height: finalCropHeight })
    }

    img.onerror = (error) => {
      nsLogger.error('Failed to load image:', error)
    }

    img.src = imageUrl
  }, [imageUrl, open])

  // Get display scale factor (accounts for CSS scaling)
  const getDisplayScale = (): number => {
    if (!imageDimensions.width || !displayDimensions.width) {
      return 1
    }
    // Canvas is at actual image resolution, displayed at calculated size
    return imageDimensions.width / displayDimensions.width
  }

  // Draw the crop overlay
  const drawCropOverlay = useCallback(() => {
    if (!canvasRef.current || !imageRef.current || !imageLoaded || !imageDimensions.width) {
      return
    }

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const { width: imgWidth, height: imgHeight } = imageDimensions

    // Set canvas size to match actual image dimensions
    canvas.width = imgWidth
    canvas.height = imgHeight

    // Clear canvas
    ctx.clearRect(0, 0, imgWidth, imgHeight)

    // Draw image at actual size (no scaling)
    const img = imageRef.current
    ctx.drawImage(img, 0, 0, imgWidth, imgHeight)

    // Get design system color
    const primaryColor = getDesignSystemColor('--primary')

    // Draw dark overlay outside crop area
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'

    // Top
    ctx.fillRect(0, 0, imgWidth, cropBox.y)
    // Left
    ctx.fillRect(0, cropBox.y, cropBox.x, cropBox.height)
    // Right
    ctx.fillRect(
      cropBox.x + cropBox.width,
      cropBox.y,
      imgWidth - (cropBox.x + cropBox.width),
      cropBox.height,
    )
    // Bottom
    ctx.fillRect(0, cropBox.y + cropBox.height, imgWidth, imgHeight - (cropBox.y + cropBox.height))

    // Scale visual elements based on display size for consistent appearance
    const displayScale = getDisplayScale()

    // Draw crop border (white)
    ctx.strokeStyle = primaryColor
    ctx.lineWidth = 2 * displayScale
    ctx.strokeRect(cropBox.x, cropBox.y, cropBox.width, cropBox.height)

    // Draw corner resize handles (scaled for visibility, positioned INSIDE crop box)
    const handleSize = 20 * displayScale
    const handleThickness = 5 * displayScale

    // Draw handles with shadow for better visibility
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 4 * displayScale
    ctx.fillStyle = primaryColor

    // Top-left - extends inward from corner
    ctx.fillRect(cropBox.x, cropBox.y, handleSize, handleThickness)
    ctx.fillRect(cropBox.x, cropBox.y, handleThickness, handleSize)

    // Top-right - extends inward from corner
    ctx.fillRect(cropBox.x + cropBox.width - handleSize, cropBox.y, handleSize, handleThickness)
    ctx.fillRect(
      cropBox.x + cropBox.width - handleThickness,
      cropBox.y,
      handleThickness,
      handleSize,
    )

    // Bottom-left - extends inward from corner
    ctx.fillRect(
      cropBox.x,
      cropBox.y + cropBox.height - handleThickness,
      handleSize,
      handleThickness,
    )
    ctx.fillRect(cropBox.x, cropBox.y + cropBox.height - handleSize, handleThickness, handleSize)

    // Bottom-right - extends inward from corner
    ctx.fillRect(
      cropBox.x + cropBox.width - handleSize,
      cropBox.y + cropBox.height - handleThickness,
      handleSize,
      handleThickness,
    )
    ctx.fillRect(
      cropBox.x + cropBox.width - handleThickness,
      cropBox.y + cropBox.height - handleSize,
      handleThickness,
      handleSize,
    )

    // Reset shadow
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }, [imageLoaded, imageDimensions, displayDimensions, cropBox, getDesignSystemColor])

  // Update crop area when it changes
  useEffect(() => {
    drawCropOverlay()
  }, [drawCropOverlay])

  // Scroll to top when image loads (once only)
  useEffect(() => {
    if (!imageLoaded || !scrollContainerRef.current || !cropBox.width) {
      return
    }

    const scrollContainer = scrollContainerRef.current
    scrollContainer.scrollTop = 0
  }, [imageLoaded, cropBox.width])

  // Get resize handle at position
  const getResizeHandle = (x: number, y: number): ResizeHandle => {
    const displayScale = getDisplayScale()
    const handleSize = 20 * displayScale
    const tolerance = 15 * displayScale // Extra clickable area

    // Top-left
    if (
      x >= cropBox.x - tolerance &&
      x <= cropBox.x + handleSize + tolerance &&
      y >= cropBox.y - tolerance &&
      y <= cropBox.y + handleSize + tolerance
    ) {
      return 'nw'
    }

    // Top-right
    if (
      x >= cropBox.x + cropBox.width - handleSize - tolerance &&
      x <= cropBox.x + cropBox.width + tolerance &&
      y >= cropBox.y - tolerance &&
      y <= cropBox.y + handleSize + tolerance
    ) {
      return 'ne'
    }

    // Bottom-left
    if (
      x >= cropBox.x - tolerance &&
      x <= cropBox.x + handleSize + tolerance &&
      y >= cropBox.y + cropBox.height - handleSize - tolerance &&
      y <= cropBox.y + cropBox.height + tolerance
    ) {
      return 'sw'
    }

    // Bottom-right
    if (
      x >= cropBox.x + cropBox.width - handleSize - tolerance &&
      x <= cropBox.x + cropBox.width + tolerance &&
      y >= cropBox.y + cropBox.height - handleSize - tolerance &&
      y <= cropBox.y + cropBox.height + tolerance
    ) {
      return 'se'
    }

    return null
  }

  // Check if point is inside crop box
  const isInsideCropBox = (x: number, y: number): boolean => {
    return (
      x >= cropBox.x &&
      x <= cropBox.x + cropBox.width &&
      y >= cropBox.y &&
      y <= cropBox.y + cropBox.height
    )
  }

  // Handle mouse down
  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || isLoading) {
      return
    }

    e.preventDefault()

    const rect = canvas.getBoundingClientRect()
    const scale = getDisplayScale()
    const x = (e.clientX - rect.left) * scale
    const y = (e.clientY - rect.top) * scale

    const handle = getResizeHandle(x, y)
    if (handle) {
      setIsResizing(handle)
      setDragStart({ x, y })
      setInitialCropBox({ ...cropBox })
    } else if (isInsideCropBox(x, y)) {
      setIsDraggingBox(true)
      setDragStart({ x: x - cropBox.x, y: y - cropBox.y })
    }
  }

  // Handle mouse move
  // eslint-disable-next-line sonarjs/cognitive-complexity
  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || isLoading) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const scale = getDisplayScale()
    const x = (e.clientX - rect.left) * scale
    const y = (e.clientY - rect.top) * scale

    // Update cursor based on position (disabled during loading)
    if (!isDraggingBox && !isResizing && !isLoading) {
      const handle = getResizeHandle(x, y)
      if (handle === 'nw' || handle === 'se') {
        canvas.style.cursor = 'nwse-resize'
      } else if (handle === 'ne' || handle === 'sw') {
        canvas.style.cursor = 'nesw-resize'
      } else if (isInsideCropBox(x, y)) {
        canvas.style.cursor = 'move'
      } else {
        canvas.style.cursor = 'default'
      }
    }

    // Handle dragging
    if (isDraggingBox) {
      e.preventDefault()
      const { width: imgWidth, height: imgHeight } = imageDimensions

      let newX = x - dragStart.x
      let newY = y - dragStart.y

      // Constrain to image bounds - ensure crop box stays fully inside image
      newX = Math.max(0, Math.min(newX, imgWidth - cropBox.width))
      newY = Math.max(0, Math.min(newY, imgHeight - cropBox.height))

      setCropBox({ ...cropBox, x: newX, y: newY })
    }

    // Handle resizing
    if (isResizing) {
      e.preventDefault()
      const { width: imgWidth, height: imgHeight } = imageDimensions
      const dx = x - dragStart.x

      const newBox = { ...initialCropBox }

      // Calculate new dimensions based on handle
      if (isResizing === 'se') {
        // Bottom-right: grow/shrink from top-left anchor
        const newWidth = initialCropBox.width + dx

        newBox.width = Math.max(100, Math.min(newWidth, imgWidth - newBox.x))
        newBox.height = newBox.width / ASPECT_RATIO

        // Constrain to image
        if (newBox.y + newBox.height > imgHeight) {
          newBox.height = imgHeight - newBox.y
          newBox.width = newBox.height * ASPECT_RATIO
        }
      } else if (isResizing === 'sw') {
        // Bottom-left: grow/shrink from top-right anchor
        const newWidth = initialCropBox.width - dx

        newBox.width = Math.max(100, Math.min(newWidth, initialCropBox.x + initialCropBox.width))
        newBox.height = newBox.width / ASPECT_RATIO
        newBox.x = initialCropBox.x + initialCropBox.width - newBox.width

        // Constrain to image
        if (newBox.y + newBox.height > imgHeight) {
          newBox.height = imgHeight - newBox.y
          newBox.width = newBox.height * ASPECT_RATIO
          newBox.x = initialCropBox.x + initialCropBox.width - newBox.width
        }
        if (newBox.x < 0) {
          newBox.x = 0
          newBox.width = initialCropBox.x + initialCropBox.width
          newBox.height = newBox.width / ASPECT_RATIO
        }
      } else if (isResizing === 'ne') {
        // Top-right: grow/shrink from bottom-left anchor
        const newWidth = initialCropBox.width + dx

        newBox.width = Math.max(100, Math.min(newWidth, imgWidth - newBox.x))
        newBox.height = newBox.width / ASPECT_RATIO
        newBox.y = initialCropBox.y + initialCropBox.height - newBox.height

        // Constrain to image
        if (newBox.y < 0) {
          newBox.y = 0
          newBox.height = initialCropBox.y + initialCropBox.height
          newBox.width = newBox.height * ASPECT_RATIO
        }
      } else if (isResizing === 'nw') {
        // Top-left: grow/shrink from bottom-right anchor
        const newWidth = initialCropBox.width - dx

        newBox.width = Math.max(100, Math.min(newWidth, initialCropBox.x + initialCropBox.width))
        newBox.height = newBox.width / ASPECT_RATIO
        newBox.x = initialCropBox.x + initialCropBox.width - newBox.width
        newBox.y = initialCropBox.y + initialCropBox.height - newBox.height

        // Constrain to image
        if (newBox.x < 0) {
          newBox.x = 0
          newBox.width = initialCropBox.x + initialCropBox.width
          newBox.height = newBox.width / ASPECT_RATIO
          newBox.y = initialCropBox.y + initialCropBox.height - newBox.height
        }
        if (newBox.y < 0) {
          newBox.y = 0
          newBox.height = initialCropBox.y + initialCropBox.height
          newBox.width = newBox.height * ASPECT_RATIO
          newBox.x = initialCropBox.x + initialCropBox.width - newBox.width
        }
      }

      setCropBox(newBox)
    }
  }

  // Handle mouse up
  const handleMouseUp = () => {
    setIsDraggingBox(false)
    setIsResizing(null)
    if (canvasRef.current) {
      canvasRef.current.style.cursor = 'default'
    }
  }

  const getCropPosition = useCallback((): Position => {
    if (!imageDimensions.width || !imageDimensions.height) {
      return {
        xPct: 0,
        yPct: 0,
        wPct: 1,
        hPct: 1,
      }
    }
    return {
      xPct: ((cropBox.x + cropBox.width / 2) / imageDimensions.width) * 2 - 1,
      yPct: -(((cropBox.y + cropBox.height / 2) / imageDimensions.height) * 2 - 1), // Need to flip yPct? In templates transform: yPct: -yPct + 1
      wPct: cropBox.width / imageDimensions.width,
      hPct: cropBox.height / imageDimensions.height,
    }
  }, [cropBox, imageDimensions])

  // Handle crop confirmation
  const handleConfirm = useCallback(() => {
    if (!canvasRef.current || !imageRef.current || isLoading) {
      return
    }

    const position = getCropPosition()

    if (mode === 'position' && onPositionConfirm) {
      onPositionConfirm(position)
      return
    }

    if (!onConfirm) {
      return
    }

    onConfirm(position)
  }, [getCropPosition, isLoading, mode, onConfirm, onPositionConfirm])

  // Handle dialog close
  const handleOpenChange = (isOpen: boolean) => {
    // Prevent closing during loading
    if (!isOpen && isLoading) {
      return
    }
    if (!isOpen) {
      onCancel()
    }
  }

  return (
    <Dialog
      classNames={{
        content:
          'border-none bg-menu-background backdrop-blur-2xl max-w-[560px] h-[560px] flex flex-col rounded-xl p-6',
        header: 'mb-0 shrink-0 space-y-1',
        title: 'text-lg font-semibold text-primary leading-tight',
      }}
      description="Adjust the keyframes to improve the shot."
      footer={
        <div className="flex gap-2 justify-end mt-4 shrink-0">
          <Button disabled={isLoading} onClick={onCancel} variant="default">
            Cancel
          </Button>
          <Button
            className={cn(
              isLoading &&
                'h-8 min-w-[100px] rounded-sm px-2.5 text-sm font-medium bg-fill-secondary hover:bg-fill-hover hover:text-primary',
            )}
            disabled={isLoading}
            onClick={handleConfirm}
            variant={isLoading ? 'ghost' : 'primary'}
          >
            {isLoading ? (
              <>
                <QuestionLoading className="size-4.5 animate-spin" />
                Processing...
              </>
            ) : (
              'Confirm'
            )}
          </Button>
        </div>
      }
      onOpenChange={handleOpenChange}
      open={open}
      showClose={!isLoading}
      title="Reframe"
    >
      <div
        className="w-full flex-1 min-h-0 flex items-center justify-center overflow-auto pr-1"
        ref={scrollContainerRef}
      >
        {/* Image / Cropper */}
        {imageLoaded && imageSource && !isLoading ? (
          <div
            className="relative"
            onMouseDown={handleMouseDown}
            onMouseLeave={handleMouseUp}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            ref={containerRef}
            style={{
              width: `${displayDimensions.width}px`,
              height: `${displayDimensions.height}px`,
            }}
          >
            <canvas
              className="absolute inset-0 size-full"
              ref={canvasRef}
              style={{
                width: `${displayDimensions.width}px`,
                height: `${displayDimensions.height}px`,
              }}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <QuestionLoading className="size-8 animate-spin text-primary" />
          </div>
        )}
      </div>
    </Dialog>
  )
}
