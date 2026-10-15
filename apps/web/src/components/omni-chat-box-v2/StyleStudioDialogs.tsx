'use client'

import { Button, cn, Dialog } from '@shared/ui'
import React, { useEffect, useRef, useState } from 'react'

import { CrossSmall, Image } from '@/components/icons/core'
import { useIsMobile } from '@/util/browserUtils'

import { LongTakeStylePicker } from './LongTakeStylePicker'
import type { ReferenceUploadButtonValue } from './ReferenceUploadButton'
import { STORY_MODE_STYLE_IMAGE_ACCEPT } from './story-mode-style-image'

export type StyleStudioDialogsProps = {
  disabled?: boolean
  isLongTakeStyleApplyEnabled?: boolean
  isLongTakeStyleApplySaving?: boolean
  isLongTakeStyleDialogOpen: boolean
  isLongTakeStyleGeneratePreviewEnabled?: boolean
  isLongTakeStylePreviewGenerating?: boolean
  longTakeStyleCustom: string
  longTakeStyleImageError?: null | string
  longTakeStyleImageValue?: null | ReferenceUploadButtonValue
  longTakeStyleInputMode?: 'image' | 'none' | 'preset' | 'text'
  longTakeStyleName: string
  longTakeStylePreviewImageUrl?: null | string
  onLongTakeStyleApply?: () => void
  onLongTakeStyleCustomChange: (value: string) => void
  onLongTakeStyleGeneratePreview?: () => void
  onLongTakeStyleImageClear?: () => void
  onLongTakeStyleImageSelect?: (file: File) => void
  onLongTakeStyleNameChange: (value: string) => void
  onLongTakeStyleTextClear?: () => void
  setIsLongTakeStyleDialogOpen: (open: boolean) => void
}

/**
 * The "Add your Style" dialog (the single-modal LongTakeStylePicker). Extracted so both the
 * desktop left-action bar (ChatBoxLeftActionsDialogs) and the mobile create
 * sheet (MobileOmniChatBoxInput) can mount it from the same shared style-draft
 * state, rather than duplicating the wiring.
 */
export const StyleStudioDialogs: React.FC<StyleStudioDialogsProps> = ({
  disabled = false,
  isLongTakeStyleApplyEnabled = false,
  isLongTakeStyleApplySaving = false,
  isLongTakeStyleDialogOpen,
  isLongTakeStyleGeneratePreviewEnabled = false,
  isLongTakeStylePreviewGenerating = false,
  longTakeStyleCustom,
  longTakeStyleImageError,
  longTakeStyleImageValue,
  longTakeStyleInputMode = 'preset',
  longTakeStyleName,
  longTakeStylePreviewImageUrl = null,
  onLongTakeStyleApply,
  onLongTakeStyleCustomChange,
  onLongTakeStyleGeneratePreview,
  onLongTakeStyleImageClear,
  onLongTakeStyleImageSelect,
  onLongTakeStyleNameChange,
  onLongTakeStyleTextClear,
  setIsLongTakeStyleDialogOpen,
}) => {
  const isMobile = useIsMobile()
  const [isStyleDragOverlay, setIsStyleDragOverlay] = useState(false)
  const styleDragCounterRef = useRef(0)
  const styleFileInputRef = useRef<HTMLInputElement>(null)

  // When overlay is shown, hide it on dragend (user dropped outside or cancelled drag)
  useEffect(() => {
    if (!isStyleDragOverlay) {
      return
    }
    const handleDragEnd = () => {
      styleDragCounterRef.current = 0
      setIsStyleDragOverlay(false)
    }
    window.addEventListener('dragend', handleDragEnd)
    return () => window.removeEventListener('dragend', handleDragEnd)
  }, [isStyleDragOverlay])

  return (
    <Dialog
      classNames={{
        content: cn(
          'z-[95] border-none p-0 gap-0 overflow-hidden shadow-none max-w-none w-auto bg-transparent rounded-none',
          'mobile-fullscreen-dialog max-sm:inset-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-full max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:flex max-sm:flex-col max-sm:bg-[#121212] max-sm:z-[82] max-sm:overflow-hidden',
        ),
        description: 'sr-only',
        header: 'sr-only',
        overlay: 'z-[94] max-sm:z-[81]',
      }}
      footer={null}
      onOpenChange={(open) => {
        setIsLongTakeStyleDialogOpen(open)
        if (!open) {
          setIsStyleDragOverlay(false)
          styleDragCounterRef.current = 0
        }
      }}
      open={isLongTakeStyleDialogOpen}
      showClose={false}
      title="Add your Style"
    >
      <div
        className={cn(
          'flex flex-col backdrop-blur-[40px] bg-[rgba(68,68,68,0.5)]',
          'sm:w-[720px] sm:h-[508px] sm:rounded-3xl sm:overflow-clip',
          'max-sm:w-full max-sm:flex-1 max-sm:rounded-t-[16px] max-sm:min-h-0 max-sm:overflow-y-auto',
        )}
        onDragEnter={(e) => {
          e.preventDefault()
          styleDragCounterRef.current++
          if (styleDragCounterRef.current === 1) {
            setIsStyleDragOverlay(true)
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          const related = e.relatedTarget as Node | null
          if (related == null || !e.currentTarget.contains(related)) {
            styleDragCounterRef.current = 0
            setIsStyleDragOverlay(false)
          }
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        {isStyleDragOverlay ? (
          <div
            className="flex flex-1 flex-col gap-2 p-4 min-h-0"
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              styleDragCounterRef.current = 0
              setIsStyleDragOverlay(false)
              const file = e.dataTransfer.files?.[0]
              if (file) {
                onLongTakeStyleImageSelect?.(file)
              }
            }}
          >
            <div
              className="flex flex-1 min-h-0 cursor-pointer flex-col items-center justify-center gap-6 rounded-sm border border-dashed border-white/10"
              onClick={() => styleFileInputRef.current?.click()}
            >
              <Image className="size-6 shrink-0 text-white" />
              <div className="flex flex-col gap-1 text-center">
                <p
                  className="text-[18px] font-semibold leading-[21.8px] text-white"
                  style={{
                    fontFeatureSettings: "'ss01' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1, 'ss03' 1",
                  }}
                >
                  Add an image
                </p>
                <p
                  className="text-sm font-normal leading-[22px] text-white/50"
                  style={{
                    fontFeatureSettings: "'ss01' 1, 'ss03' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1",
                  }}
                >
                  Add any image file here to generate a style instruction
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-4 items-start p-4 shrink-0">
              <div className="flex flex-1 flex-col justify-center min-h-[22px] py-[3px]">
                <h2
                  className="text-[18px] font-semibold leading-[21.8px] text-primary max-sm:text-[16px] max-sm:font-medium max-sm:leading-[20px]"
                  style={{
                    fontFeatureSettings: "'ss01' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1, 'ss03' 1",
                  }}
                >
                  Add your Style
                </h2>
                <p
                  className="text-[14px] font-normal leading-[22px] text-white/50 max-sm:font-medium max-sm:leading-tight"
                  style={{
                    fontFeatureSettings: "'ss01' 1, 'ss03' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1",
                  }}
                >
                  {isMobile ? (
                    <>
                      Upload an image as a reference or
                      <br />
                      enter custom style text
                    </>
                  ) : (
                    'Upload a style image or enter custom style text to generate your own style'
                  )}
                </p>
              </div>
              <Button
                aria-label="Close"
                className="size-[28px] shrink-0 rounded-full bg-white/10 flex items-center justify-center p-0 hover:bg-white/20 max-sm:size-[38px]"
                onClick={() => setIsLongTakeStyleDialogOpen(false)}
                type="button"
                variant="ghost"
              >
                <CrossSmall className="size-6" />
              </Button>
            </div>
            <div className="flex flex-1 flex-col min-h-0 px-4 pb-4">
              <LongTakeStylePicker
                customStyle={longTakeStyleCustom}
                isApplyEnabled={isLongTakeStyleApplyEnabled && !disabled}
                isApplySaving={isLongTakeStyleApplySaving}
                isGeneratePreviewEnabled={isLongTakeStyleGeneratePreviewEnabled}
                isPreviewGenerating={isLongTakeStylePreviewGenerating}
                onApply={onLongTakeStyleApply}
                onBrowseClick={() => styleFileInputRef.current?.click()}
                onClose={() => setIsLongTakeStyleDialogOpen(false)}
                onCustomStyleChange={onLongTakeStyleCustomChange}
                onCustomStyleClear={onLongTakeStyleTextClear}
                onGeneratePreview={onLongTakeStyleGeneratePreview}
                onStyleImageClear={onLongTakeStyleImageClear}
                onStyleImageSelect={onLongTakeStyleImageSelect}
                onStyleNameChange={onLongTakeStyleNameChange}
                previewImageUrl={longTakeStylePreviewImageUrl}
                styleImageError={longTakeStyleImageError}
                styleImageValue={longTakeStyleImageValue}
                styleInputMode={longTakeStyleInputMode}
                styleName={longTakeStyleName}
              />
            </div>
          </>
        )}
        <input
          accept={STORY_MODE_STYLE_IMAGE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) {
              onLongTakeStyleImageSelect?.(file)
              setIsStyleDragOverlay(false)
              styleDragCounterRef.current = 0
            }
            if (styleFileInputRef.current) {
              styleFileInputRef.current.value = ''
            }
          }}
          ref={styleFileInputRef}
          type="file"
        />
      </div>
    </Dialog>
  )
}
