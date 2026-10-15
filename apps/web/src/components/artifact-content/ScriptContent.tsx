'use client'

import { cn, Textarea } from '@shared/ui'
import { type ReactNode, useId } from 'react'

/** The word-count readout under the script. `max` renders the "/ N words" budget when present. */
export interface ScriptWordCount {
  max?: number
  value: number
}

/**
 * Turns the script into an editable textarea instead of static text. Omit it on a surface whose
 * script is read-only and no edit affordance renders at all.
 */
export interface ScriptContentProps {
  editable?: ScriptEditable
  /** Rendered in the metrics row beside the word count, e.g. an estimated duration. */
  footer?: ReactNode
  /** Overrides the default `data-testid` on the text element, for a surface with existing selectors. */
  testId?: string
  text: string
  wordCount?: ScriptWordCount
}

export interface ScriptEditable {
  autoFocus?: boolean
  /** When true, the textarea keeps its bordered box; otherwise it sits flat against its host. */
  boxed?: boolean
  /**
   * When true, the field's height follows its content, floored by `min-h-[220px]` and capped at
   * the height its host gives it -- past that the text scrolls. Needs a host with a definite
   * height; a content-sized one has nothing to stop the growth. Where `field-sizing` is
   * unsupported the field holds the floor.
   */
  growWithContent?: boolean
  onBlur?: () => void
  onChange: (nextText: string) => void
  onFocus?: () => void
}

/**
 * The Script artifact's content presentation, shared by both canvas surfaces: the
 * narration itself, plus an optional word-count row under it. Line breaks are preserved - the
 * script's paragraphing is authored, not incidental.
 *
 * Backend-agnostic on purpose - display text and hints in, no session or planner state and no
 * fetching, so each surface maps its own state onto these props. Keep that boundary.
 *
 * The edit affordance is optional because only one surface can edit the script today; it is the
 * seam through which in-canvas editing later reaches the read-only surface.
 */
export function ScriptContent({
  editable,
  footer,
  testId,
  text,
  wordCount,
}: Readonly<ScriptContentProps>) {
  // `footer` is a node, so a caller whose footer collapsed to `null` gets no row at all rather than
  // an empty one holding a gap.
  const hasMetrics = wordCount !== undefined || (footer !== undefined && footer !== null)
  const labelId = useId()
  return (
    <>
      {editable ? (
        <>
          <span className="sr-only" id={labelId}>
            Script
          </span>
          <Textarea
            aria-labelledby={labelId}
            autoFocus={editable.autoFocus}
            className={cn(
              // Spelled out instead of the `text-body-md` token: tailwind-merge does not recognise
              // the custom font-size key, so the token cannot displace the field's own base
              // `text-sm` and the text renders at 14/20.
              'scrollbar-thumb-muted-gray min-h-[220px] resize-none text-[16px] leading-[26px] tracking-[-0.12px] text-primary placeholder:text-white/40 focus:border-white/30 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring',
              // Growing: `field-sizing` makes the height intrinsic, and the default flex shrink
              // caps it at the host's height (floored by min-h), where the text scrolls instead.
              // Fixed: fill the host, which on a content-sized one leaves the min-height.
              editable.growWithContent ? '[field-sizing:content]' : 'h-full flex-1',
              editable.boxed &&
                'rounded-sm border border-white/10 bg-black/15 px-5 py-4 transition-colors hover:border-white/20',
            )}
            data-testid={testId ?? 'script-content-textarea'}
            onBlur={editable.onBlur}
            onChange={editable.onChange}
            onFocus={editable.onFocus}
            value={text}
          />
        </>
      ) : (
        <div
          className="scrollbar-thumb-muted-gray text-body-md flex-1 min-h-0 overflow-y-auto whitespace-pre-wrap text-primary"
          data-testid={testId ?? 'script-content-text'}
        >
          {text}
        </div>
      )}

      {hasMetrics && (
        <div className="flex flex-wrap items-center gap-3">
          {wordCount && <ScriptWordCountReadout wordCount={wordCount} />}
          {footer}
        </div>
      )}
    </>
  )
}

/**
 * The word-count readout on its own, for a surface that renders it outside this component's metrics
 * row.
 */
export function ScriptWordCountReadout({ wordCount }: Readonly<{ wordCount: ScriptWordCount }>) {
  const { max, value } = wordCount
  const overLimit = max !== undefined && value > max
  return (
    <div className="text-label-sm flex items-center gap-0.5 whitespace-nowrap">
      <span className={overLimit ? 'text-red-300' : 'text-primary'}>{value}</span>
      {max === undefined ? (
        <span className="text-secondary">words</span>
      ) : (
        <>
          <span className={overLimit ? 'text-red-300' : 'text-secondary'}>/</span>
          <span className={overLimit ? 'text-red-300' : 'text-secondary'}>{max} words</span>
        </>
      )}
    </div>
  )
}
