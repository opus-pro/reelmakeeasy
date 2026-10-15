'use client'

import { cn, ExternalImage } from '@shared/ui'
import { useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'

import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'

import { FONT_FEATURE_SETTINGS } from '../defaults'
import { getBrandSelectedSavedStyleAtom } from '../state/atoms/planner'
import { usePlannerState } from '../state/planner-context'

const LABEL_CLASSES = 'text-xs font-medium uppercase tracking-wider text-primary/50'

interface BrandStyleCardProps {
  // A full 4-up row uses compact 179px square tiles; 1-3 styles use taller
  // 207px tiles with a larger label.
  compact: boolean
  disabled: boolean
  imageUrl: null | string
  label: string
  onSelect: () => void
  selected: boolean
  // A lone style fills only half the row (left-aligned) rather than stretching
  // to full width, matching the two-up tile width.
  singleStyle: boolean
}

interface BrandStylesPickerProps {
  defaultStyleId: null | string
  disabled: boolean
  loading: boolean
  styles: StoryModeStyleOption[]
}

function previewOf(option: StoryModeStyleOption): null | string {
  return option.scenePreviewUrls?.[0] ?? option.thumbnailUrl ?? null
}

// The brand's own saved styles, shown in the brand-review for a reused saved
// brief. The user picks one; the choice is published to the
// selected-saved-style atom so confirmBrandReview applies it as the hybrid look.
export function BrandStylesPicker({
  defaultStyleId,
  disabled,
  loading,
  styles,
}: BrandStylesPickerProps) {
  const state = usePlannerState()
  const setSelectedStyle = useSetAtom(getBrandSelectedSavedStyleAtom(state))

  const [pickedId, setPickedId] = useState<null | string>(null)
  const activeId = pickedId ?? defaultStyleId

  useEffect(() => {
    const chosen = styles.find((style) => style.id === activeId) ?? null
    setSelectedStyle(
      chosen ? { previewUrl: previewOf(chosen), styleText: chosen.styleText ?? null } : null,
    )
  }, [activeId, setSelectedStyle, styles])

  // Cards stretch to fill the row (flex-1), so 2-4 styles read as progressively
  // narrower tiles. A full 4-up row switches to the compact tile size;
  // 2-3 styles stay on the larger tiles. A lone
  // style is the exception: it fills only half the row.
  const compact = styles.length >= 4
  const singleStyle = styles.length === 1

  return (
    <div className="flex flex-col gap-1.5" data-testid="uip-brand-styles-picker">
      <span className={LABEL_CLASSES} style={FONT_FEATURE_SETTINGS}>
        Brand styles
      </span>
      <div className={cn('flex', compact ? 'gap-3' : 'gap-4')}>
        {loading && styles.length === 0
          ? Array.from({ length: 2 }).map((_, index) => (
              <div className="h-[207px] flex-1 animate-pulse rounded-xl bg-white/5" key={index} />
            ))
          : styles.map((style) => (
              <BrandStyleCard
                compact={compact}
                disabled={disabled}
                imageUrl={previewOf(style)}
                key={style.id}
                label={style.label}
                onSelect={() => setPickedId(style.id)}
                selected={style.id === activeId}
                singleStyle={singleStyle}
              />
            ))}
      </div>
    </div>
  )
}

function BrandStyleCard({
  compact,
  disabled,
  imageUrl,
  label,
  onSelect,
  selected,
  singleStyle,
}: BrandStyleCardProps) {
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => {
    setImgFailed(false)
  }, [imageUrl])
  return (
    <button
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-xl border-2 bg-black/15 transition-colors',
        singleStyle ? 'w-1/2' : 'flex-1',
        compact ? 'h-[179px]' : 'h-[207px]',
        selected ? 'border-white' : 'border-transparent hover:border-white/40',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      data-testid="uip-brand-styles-card"
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      {imageUrl && !imgFailed ? (
        <ExternalImage
          alt={label}
          className="size-full object-cover"
          loading="lazy"
          onError={() => setImgFailed(true)}
          src={imageUrl}
        />
      ) : (
        <div className="size-full bg-white/5" />
      )}
      <span
        className={cn(
          'absolute flex size-5 items-center justify-center rounded-full border',
          compact ? 'right-2 top-2' : 'right-2.5 top-2.5',
          selected ? 'border-white bg-white' : 'border-white/60 bg-black/30',
        )}
      >
        {selected ? <span className="size-2 rounded-full bg-black" /> : null}
      </span>
      <span
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 text-left font-medium text-white',
          compact ? 'text-sm' : 'text-base',
        )}
        style={FONT_FEATURE_SETTINGS}
      >
        {label}
      </span>
    </button>
  )
}
