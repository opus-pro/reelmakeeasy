'use client'

import type { QuickStartTemplateAsset } from '@shared/types/assets/quick-start'
import { cn } from '@shared/ui'
import Image from 'next/image'
import React, { useMemo } from 'react'

import { BRollImages, Maximize } from '@/components/icons/core'
import { META_TAG_REGEX } from '@/components/markdown-editor/custom-nodes/meta-tag-regex'

import { StoryModeAudioToVideoPill } from './StoryModeAudioToVideoPill'

interface StoryModeInputTranscriptPanelsProps {
  activeSection?: StoryModePanelSection
  assets?: QuickStartTemplateAsset[]
  audioUrl?: string
  initPrompt?: string
  isMobile?: boolean
  onActiveSectionChange?: (section: StoryModePanelSection) => void
  onPreviewAssetChange?: (asset: QuickStartTemplateAsset) => void
  script?: string
  /**
   * Off for projects with no transcript track, where a permanent "not available
   * yet" card would read as a stuck project. Story mode keeps it while generating.
   */
  showTranscript?: boolean
}

type StoryModePanelSection = 'input' | 'transcript'

const MAX_VISIBLE_ASSETS = 8
// The canonical parser (not a simpler ad-hoc pattern): resourceIds/metadata can
// contain literal parentheses (e.g. a filename like "My-Song (1).mp4"), which
// a naive `[^)]*` stops at, leaking the tag's tail into the displayed prompt.
const META_TAG_GLOBAL_REGEX = new RegExp(META_TAG_REGEX.source, 'g')

const FROSTED_PANEL_CLASS =
  'relative isolate overflow-hidden rounded-2xl bg-[#2a2a2a] [contain:paint]'
const COLLAPSED_PANEL_BUTTON_CLASS = cn(FROSTED_PANEL_CLASS, 'h-full w-full text-left')
const PANEL_SCROLL_CONTENT_CLASS =
  'relative z-10 flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto scrollbar-hide'

export const StoryModeInputTranscriptPanels: React.FC<StoryModeInputTranscriptPanelsProps> = ({
  activeSection = 'input',
  assets,
  audioUrl,
  initPrompt,
  isMobile = false,
  onActiveSectionChange,
  onPreviewAssetChange,
  script,
  showTranscript = true,
}) => {
  const filteredAssets = useMemo(
    () =>
      (assets ?? [])
        .filter(
          (asset) => asset.mimeType.startsWith('image/') || asset.mimeType.startsWith('video/'),
        )
        .slice(0, MAX_VISIBLE_ASSETS),
    [assets],
  )

  const displayUserPrompt = useMemo(() => {
    const trimmedPrompt = initPrompt?.trim()
    if (!trimmedPrompt) {
      return undefined
    }

    const normalizedPrompt = normalizeStoryModePrompt(trimmedPrompt)
    if (!normalizedPrompt) {
      return undefined
    }

    // Hide the prompt when it's identical to the transcript AND this is an
    // audio submission. Audio-only projects persist the transcript as
    // initPrompt, so showing both would be redundant. For text-to-video
    // projects the prompt is the user's actual input and should always show.
    if (audioUrl) {
      const normalizedScript = normalizeStoryModePrompt(script)
      if (normalizedPrompt === normalizedScript) {
        return undefined
      }
    }

    return normalizedPrompt
  }, [audioUrl, initPrompt, script])

  const displayScript = script ?? 'Transcript not available yet.'
  const panelPaddingClassName = isMobile ? 'p-4' : 'p-6'
  const canCollapse = !isMobile && onActiveSectionChange && showTranscript

  if (!showTranscript) {
    return (
      <InputPanel
        audioUrl={audioUrl}
        className={isMobile ? 'shrink-0' : 'min-h-0 flex-1'}
        displayUserPrompt={displayUserPrompt}
        filteredAssets={filteredAssets}
        onPreviewAssetChange={onPreviewAssetChange}
        panelPaddingClassName={panelPaddingClassName}
      />
    )
  }

  // When the only input is audio or assets (no prompt), render as a
  // non-collapsible card with transcript filling the remaining space.
  // Prompt-only still uses the collapsible layout since prompts can be long.
  const isCompactInput = !displayUserPrompt && Boolean(audioUrl) !== filteredAssets.length > 0

  if (isCompactInput) {
    return (
      <>
        <InputPanel
          audioUrl={audioUrl}
          className="shrink-0"
          filteredAssets={filteredAssets}
          onPreviewAssetChange={onPreviewAssetChange}
          panelPaddingClassName={panelPaddingClassName}
        />

        <TranscriptPanel
          className="min-h-0 flex-1"
          displayScript={displayScript}
          panelPaddingClassName={panelPaddingClassName}
        />
      </>
    )
  }

  if (canCollapse) {
    const inputExpanded = activeSection === 'input'
    const transcriptButton = (
      <CollapsedPanelButton
        icon={
          <div className="flex size-[18px] items-center justify-center text-sm font-medium leading-[17px] text-white">
            T
          </div>
        }
        label="Video transcript"
        onClick={() => onActiveSectionChange('transcript')}
      />
    )
    const inputButton = (
      <CollapsedPanelButton
        icon={<BRollImages className="size-[18px] shrink-0 text-white" />}
        label="User prompt"
        onClick={() => onActiveSectionChange('input')}
      />
    )
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
        <div
          className={cn(
            'min-h-[70px] basis-0 overflow-hidden transition-[flex-grow] duration-[350ms] ease-out',
            inputExpanded ? 'grow' : 'grow-0',
          )}
        >
          {inputExpanded ? (
            <InputPanel
              audioUrl={audioUrl}
              className="size-full"
              displayUserPrompt={displayUserPrompt}
              filteredAssets={filteredAssets}
              onPreviewAssetChange={onPreviewAssetChange}
              panelPaddingClassName={panelPaddingClassName}
            />
          ) : (
            inputButton
          )}
        </div>
        <div
          className={cn(
            'min-h-[70px] basis-0 overflow-hidden transition-[flex-grow] duration-[350ms] ease-out',
            inputExpanded ? 'grow-0' : 'grow',
          )}
        >
          {inputExpanded ? (
            transcriptButton
          ) : (
            <TranscriptPanel
              className="size-full"
              displayScript={displayScript}
              panelPaddingClassName={panelPaddingClassName}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <InputPanel
        audioUrl={audioUrl}
        className="shrink-0"
        displayUserPrompt={displayUserPrompt}
        filteredAssets={filteredAssets}
        onPreviewAssetChange={onPreviewAssetChange}
        panelPaddingClassName={panelPaddingClassName}
      />

      <TranscriptPanel
        className="min-h-0 flex-1"
        displayScript={displayScript}
        panelPaddingClassName={panelPaddingClassName}
      />
    </>
  )
}

function CollapsedPanelButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button className={COLLAPSED_PANEL_BUTTON_CLASS} onClick={onClick} type="button">
      <div className="relative z-10 flex h-full items-center justify-between px-6">
        <div className="flex min-h-[38px] items-center gap-1.5">
          {icon}
          <span className="text-sm font-medium leading-[17px] text-white">{label}</span>
        </div>
        <Maximize className="size-4 shrink-0 text-white/50" />
      </div>
    </button>
  )
}

function InputPanel({
  audioUrl,
  className,
  displayUserPrompt,
  filteredAssets,
  onPreviewAssetChange,
  panelPaddingClassName,
}: {
  audioUrl?: string
  className?: string
  displayUserPrompt?: string
  filteredAssets: QuickStartTemplateAsset[]
  onPreviewAssetChange?: (asset: QuickStartTemplateAsset) => void
  panelPaddingClassName: string
}) {
  return (
    <div className={cn(FROSTED_PANEL_CLASS, 'w-full', className)}>
      <div className={cn(PANEL_SCROLL_CONTENT_CLASS, 'gap-6', panelPaddingClassName)}>
        {filteredAssets.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-normal uppercase leading-[22px] text-white/50">
              User Assets
            </p>
            <div className="flex flex-wrap gap-2">
              {/* Only a caller that can actually open a preview gets the button: the mobile
                  drawer and the pre-frame desktop dialog mount no preview dialog, and a
                  focusable "Preview ..." that does nothing is worse than a plain thumbnail. */}
              {filteredAssets.map((asset) =>
                onPreviewAssetChange ? (
                  <button
                    aria-label={`Preview ${asset.name || 'user asset'}`}
                    className="rounded-sm transition-transform duration-150 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    key={asset.url}
                    onClick={() => onPreviewAssetChange(asset)}
                    type="button"
                  >
                    <AssetThumbnail asset={asset} className="size-[52px] shrink-0 rounded-sm" />
                  </button>
                ) : (
                  <AssetThumbnail
                    asset={asset}
                    className="size-[52px] shrink-0 rounded-sm"
                    key={asset.url}
                  />
                ),
              )}
            </div>
          </div>
        )}

        {audioUrl && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-normal uppercase leading-[22px] text-white/50">
              Audio to video
            </p>
            <StoryModeAudioToVideoPill audioUrl={audioUrl} />
          </div>
        )}

        {displayUserPrompt && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-normal uppercase leading-[22px] text-white/50">
              User Prompt
            </p>
            <p className="whitespace-pre-wrap break-words text-sm font-normal leading-[22px] text-white [overflow-wrap:anywhere]">
              {displayUserPrompt}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function TranscriptPanel({
  className,
  displayScript,
  panelPaddingClassName,
}: {
  className?: string
  displayScript: string
  panelPaddingClassName: string
}) {
  return (
    <div className={cn(FROSTED_PANEL_CLASS, className)}>
      <div className={cn(PANEL_SCROLL_CONTENT_CLASS, 'gap-5', panelPaddingClassName)}>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-normal uppercase leading-[22px] text-white/50">Transcript</p>
          <p className="whitespace-pre-wrap break-words text-sm font-normal leading-[22px] text-white [overflow-wrap:anywhere]">
            {displayScript}
          </p>
        </div>
      </div>
    </div>
  )
}

const AssetThumbnail: React.FC<{
  asset: QuickStartTemplateAsset
  className?: string
}> = ({ asset, className }) => {
  const isVideo = asset.mimeType.startsWith('video/')

  return (
    <div className={cn('relative size-10 overflow-hidden rounded-lg', className)}>
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

function normalizeStoryModePrompt(value?: string) {
  return value?.replace(META_TAG_GLOBAL_REGEX, '').trim()
}
