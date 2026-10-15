'use client'

import { Button, cn, Tooltip } from '@shared/ui'
import { type ComponentType } from 'react'

import {
  DashboardNewsArticleToVideo,
  Microphone,
  Monetize,
  Voiceover,
} from '@/components/icons/core'
import { ScriptToVideoIcon } from '@/components/icons/DashboardUseCaseIcons'
import {
  type CreateUseCaseConfig,
  type CreateUseCaseKey,
  getDashboardUseCases,
} from '@/constants/create-use-cases'
import { useIsMobile } from '@/util/browserUtils'

interface DashboardUseCaseButtonProps {
  disabled: boolean
  isSelected: boolean
  onSelect: (key: CreateUseCaseKey) => void
  useCase: CreateUseCaseConfig
}

interface DashboardUseCaseButtonsProps {
  disabled?: boolean
  onSelect: (key: CreateUseCaseKey) => void
  selectedUseCaseKey?: CreateUseCaseKey
}

const USE_CASE_TOOLTIP_CONTENT: Partial<Record<CreateUseCaseKey, string>> = {
  'animation-style-ad': 'Upload assets to create your animated ad',
  'audio-to-video': 'Upload audio to create your video',
  'news-article-to-video': 'Create a video from a news or article link',
  'song-to-video': 'Upload a song to create a music video',
}

const USE_CASE_ICON_MAP: Record<CreateUseCaseKey, ComponentType<{ className?: string }>> = {
  'animation-style-ad': Monetize,
  'audio-to-video': Voiceover,
  'news-article-to-video': DashboardNewsArticleToVideo,
  'script-to-video': ScriptToVideoIcon,
  'song-to-video': Microphone,
}

export function DashboardUseCaseButtons({
  disabled = false,
  onSelect,
  selectedUseCaseKey,
}: DashboardUseCaseButtonsProps) {
  // Skip hover tooltips on mobile - shared/ui's Tooltip switches to
  // trigger="click" on touch widths, where a tap-to-open-tooltip would
  // conflict with the tap that should immediately select the use case.
  const isMobile = useIsMobile()
  const useCases = getDashboardUseCases()

  const handleSelect = (key: CreateUseCaseKey) => {
    onSelect(key)
  }

  const renderUseCaseButton = (useCase: CreateUseCaseConfig) => {
    const tooltipContent = USE_CASE_TOOLTIP_CONTENT[useCase.key]
    const button = (
      <DashboardUseCaseButton
        disabled={disabled}
        isSelected={useCase.key === selectedUseCaseKey}
        onSelect={handleSelect}
        useCase={useCase}
      />
    )

    if (!tooltipContent || isMobile) {
      return <span key={useCase.key}>{button}</span>
    }

    return (
      <Tooltip
        className="rounded-xs border-0 bg-menu px-2 py-1.5 text-sm font-medium leading-[17px] text-primary shadow-none"
        content={tooltipContent}
        key={useCase.key}
        side="top"
      >
        <span className="inline-flex">{button}</span>
      </Tooltip>
    )
  }

  return (
    <div className="flex w-full justify-start items-center gap-2">
      {useCases.map(renderUseCaseButton)}
    </div>
  )
}

function DashboardUseCaseButton({
  disabled,
  isSelected,
  onSelect,
  useCase,
}: DashboardUseCaseButtonProps) {
  const Icon = USE_CASE_ICON_MAP[useCase.key]

  return (
    <Button
      className={cn(
        // Dashboard quickstart chip: 38px square minimum.
        'relative h-9.5 min-w-9.5 shrink-0 gap-1.5 px-2.5 text-white',
        // Selected: tonal fill, NO stroke. Unselected: subtle
        // border, transparent fill, fills on hover.
        // Hover matches the selected chip, which carries no visible border. The
        // border stays at transparent rather than being dropped, so the chip does
        // not shift by a pixel under the pointer.
        isSelected
          ? 'bg-white/10'
          : 'border border-white/10 hover:border-transparent hover:bg-white/10',
      )}
      disabled={disabled}
      onClick={() => {
        onSelect(useCase.key)
      }}
      type="button"
      variant="base"
    >
      <Icon className="size-4.5 shrink-0 text-white" />
      {useCase.dashboardV2SidebarLabel}
    </Button>
  )
}
