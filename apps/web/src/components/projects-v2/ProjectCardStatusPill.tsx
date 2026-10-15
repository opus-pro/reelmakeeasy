'use client'

import { cn } from '@shared/ui'

import { CheckMark } from '@/components/icons/core'

/**
 * The background-job status pill pinned on a project card thumbnail
 * (the dashboard design's `Button Small`).
 *
 * Presentational only -- it neither knows which job it reports nor where it
 * sits, so the same pill can serve any background job. The consumer owns
 * positioning.
 *
 * `progressLabel` is optional because not every job has progress to show: BGM
 * (re)generation has no progress signal at all and renders the label alone.
 */
export type ProjectCardStatusPillProps = {
  className?: string
  label: string
  /** Trailing progress text, e.g. `32%`. Omitted when the job has no progress. */
  progressLabel?: string
  variant: ProjectCardStatusPillVariant
}

export type ProjectCardStatusPillVariant = 'done' | 'progress'

export function ProjectCardStatusPill({
  className,
  label,
  progressLabel,
  variant,
}: ProjectCardStatusPillProps) {
  return (
    <div
      className={cn(
        // bg + blur are the Figma `UI/menu background` token (#44444480) at
        // 40px blur -- via the theme-aware `menu` token rather than the literal,
        // matching BgmProcessingDialog. The pill never intercepts clicks meant
        // for the card.
        'bg-menu/50 pointer-events-none inline-flex h-8 max-w-full items-center justify-center gap-1 rounded-full px-2 backdrop-blur-[40px]',
        className,
      )}
      data-testid="project-card-status-pill"
      data-variant={variant}
      // The label changes underneath the user (running -> finished), so screen
      // readers need it announced rather than silently swapped.
      role="status"
    >
      {variant === 'progress' ? (
        <span
          aria-hidden
          className="size-4 shrink-0 animate-spin rounded-full border-[1.5px] border-white/20 border-t-white/70"
          data-testid="project-card-status-pill-spinner"
        />
      ) : (
        <span
          aria-hidden
          className="bg-accent-green flex size-4 shrink-0 items-center justify-center rounded-full"
          data-testid="project-card-status-pill-check"
        >
          <CheckMark className="size-2.5 text-black" />
        </span>
      )}
      {/* Truncates instead of wrapping: the pill is nearly as wide as the card,
          and a two-line pill would cover the thumbnail. */}
      <span className="truncate px-0.5 text-sm font-medium leading-[17px] text-white">{label}</span>
      {progressLabel ? (
        <span className="shrink-0 text-sm font-medium leading-[17px] text-white">
          {progressLabel}
        </span>
      ) : null}
    </div>
  )
}
