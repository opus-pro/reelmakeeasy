import { CornerDownLeft } from 'lucide-react'
import type { ReactNode, Ref } from 'react'

import { cn } from '../lib/utils'

/**
 * One selectable row: badge slot + label/description + optional trailing endIcon hint. `active`
 * is the ephemeral keyboard/hover highlight; `selected` is a persisted pick. Either state renders
 * the orange chip and primary-colored label; `selected` additionally shows (when `onConfirm` is
 * given) a trailing return-icon button. The row button and the confirm button are siblings (not
 * nested) since a button inside a button is invalid HTML.
 */
export function OptionRow({
  active,
  activeBadgeClassName = 'bg-accent-orange',
  badge,
  description,
  disabled = false,
  endIcon,
  label,
  onConfirm,
  onFocus,
  onMouseEnter,
  onSelect,
  ref,
  selected,
}: {
  active: boolean
  /** Selected-state chip background override; default matches the Figma spec (orange). */
  activeBadgeClassName?: string
  badge: ReactNode
  description?: string
  disabled?: boolean
  endIcon?: ReactNode
  label: string
  /** Fired by the trailing return-icon button; only rendered while the row is selected. */
  onConfirm?: () => void
  onFocus?: () => void
  onMouseEnter?: () => void
  onSelect: () => void
  ref?: Ref<HTMLButtonElement>
  selected: boolean
}) {
  const trailingIcon =
    endIcon ?? (selected ? <CornerDownLeft aria-hidden className="size-4.5" /> : null)

  return (
    <div
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[16px] p-2 transition-colors',
        // The hover lives here rather than on the button, and only the button takes `disabled`, so
        // an inert row would still light up under the pointer unless the class is dropped.
        selected
          ? 'bg-fill-tertiary'
          : cn(disabled ? '' : 'hover:bg-fill-hover', active ? 'bg-fill-hover' : ''),
      )}
    >
      <button
        aria-pressed={selected}
        className={cn(
          'flex flex-1 gap-2.5 text-left disabled:cursor-not-allowed disabled:opacity-40',
          description ? 'items-start' : 'items-center',
        )}
        disabled={disabled}
        onClick={onSelect}
        onFocus={onFocus}
        onMouseEnter={onMouseEnter}
        ref={ref}
        type="button"
      >
        <span
          className={cn(
            'flex size-7.5 shrink-0 items-center justify-center rounded-sm px-2.5 text-[14px] font-medium',
            selected || active
              ? cn(activeBadgeClassName, 'text-primary')
              : 'bg-fill-secondary text-secondary',
          )}
        >
          {badge}
        </span>
        <span className="flex flex-col justify-center">
          <span
            className={cn(
              'text-[16px] leading-6.5 tracking-[-0.12px]',
              selected || active ? 'text-primary' : 'text-secondary',
            )}
          >
            {label}
          </span>
          {description ? (
            <span className="text-[14px] leading-[22px] text-secondary">{description}</span>
          ) : null}
        </span>
      </button>
      {trailingIcon ? (
        selected && onConfirm ? (
          <button
            aria-label="Confirm"
            className="ml-auto flex size-7.5 shrink-0 items-center justify-center self-center text-secondary disabled:cursor-not-allowed disabled:opacity-40"
            // Native Enter activation already fires onConfirm; this marks the subtree so a
            // window-level key handler can skip it rather than confirm a second time by
            // activeIndex. A capture-phase listener runs before the event reaches this button,
            // so stopPropagation here would be too late to do that job.
            data-option-confirm=""
            disabled={disabled}
            onClick={onConfirm}
            onFocus={onFocus}
            type="button"
          >
            {trailingIcon}
          </button>
        ) : (
          <span className="ml-auto flex size-7.5 shrink-0 items-center justify-center self-center p-1.5 text-secondary">
            {trailingIcon}
          </span>
        )
      ) : null}
    </div>
  )
}
