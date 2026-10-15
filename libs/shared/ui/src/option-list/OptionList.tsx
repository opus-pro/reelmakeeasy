import { CornerDownLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Fragment, useEffect, useRef } from 'react'

import {
  isActiveElementEditing,
  isEventTargetEditing,
  isTypingInEditableField,
} from '../lib/is-active-element-editing'

import { isDividerHiddenBetween, OptionDivider } from './OptionDivider'
import { OptionRow } from './OptionRow'
import { useSelectableOptionList } from './useSelectableOptionList'

/**
 * The composed layer over useSelectableOptionList + OptionRow + OptionDivider. Compose through
 * this rather than hand-rolling that loop; extend it here when a surface does not fit.
 *
 * Two activation modes: 'confirm' (default) keeps today's behavior -- Enter/click on an
 * already-selected active row dispatches onConfirm instead of onSelect, with a return-icon confirm
 * button on selected rows. 'immediate' drops confirm semantics entirely -- Enter/click always fires
 * onSelect, and the *active* row (not the selected one) gets the return-icon hint instead.
 *
 * Three keyboard scopes: 'window' (default) is today's behavior -- the list responds to arrow keys
 * and Enter from anywhere on the page via a window-level listener, including while another field
 * has focus. 'container' scopes that to a keydown handler on the list's own div. 'none' attaches no
 * keyboard handling at all.
 */
const INTERACTIVE_CONTROL = 'a[href], button, input, select, summary, textarea, [role="button"]'

export type OptionListRow = {
  badge?: ReactNode
  description?: string
  disabled?: boolean
  endIcon?: ReactNode
  id?: string
  label: string
}

export function OptionList({
  activation = 'confirm',
  activeBadgeClassName,
  disabled = false,
  dividers = true,
  highlightActive = true,
  keyboardScope = 'window',
  onConfirm,
  onSelect,
  options,
  rowTestId,
  selected = [],
  trailing,
}: {
  activation?: 'confirm' | 'immediate'
  activeBadgeClassName?: string
  disabled?: boolean
  dividers?: boolean
  /** When false, no row renders as active -- suppresses the highlight and the active-row Return hint of 'immediate' activation. Keyboard navigation state is unaffected, and so is OptionRow's own selected-row Return affordance. */
  highlightActive?: boolean
  keyboardScope?: 'container' | 'none' | 'window'
  /** When given, Enter on an already-selected active row and its return-icon click dispatch this instead of onSelect. Ignored in 'immediate' activation. */
  onConfirm?: (label: string, row: OptionListRow) => void
  onSelect: (label: string, row: OptionListRow) => void
  options: OptionListRow[]
  rowTestId?: (row: OptionListRow) => string
  selected?: string[]
  trailing?: ReactNode
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const { activeIndex, handleKeyDown, registerRowRef, setActiveIndex } = useSelectableOptionList({
    count: options.length,
    onEnter: (index) => {
      const option = options[index]
      // Arrow navigation still lands on disabled rows, so Enter has to bail where the row's
      // disabled button already blocks the pointer.
      if (!option || option.disabled) {
        return
      }
      if (activation === 'confirm' && onConfirm && selected.includes(rowKey(option))) {
        onConfirm(option.label, option)
      } else {
        onSelect(option.label, option)
      }
    },
  })

  useEffect(() => {
    if (keyboardScope !== 'window' || disabled || options.length === 0) {
      return
    }

    function handleWindowKeyDown(event: KeyboardEvent) {
      // In 'immediate' mode Enter submits, so any focused editable owns its keys even while empty.
      // In 'confirm' mode a stray Enter only re-picks the active row, so an empty field can keep
      // driving the list.
      const editableOwnsEvent =
        activation === 'immediate'
          ? isEventTargetEditing(event.target) || isActiveElementEditing()
          : isTypingInEditableField(event)
      if (editableOwnsEvent) {
        return
      }
      // The confirm affordance activates on its own Enter; acting here too would confirm twice.
      if (event.target instanceof Element && event.target.closest('[data-option-confirm]')) {
        return
      }
      // Any other focused control owns its own Enter, so the card's Back/Next/Send buttons are not
      // hijacked into confirming an option. Rows inside this list are the exception: the hook
      // dispatches for them, keeping Enter a confirm rather than a re-pick.
      if (event.key === 'Enter' && event.target instanceof Element) {
        const control = event.target.closest(INTERACTIVE_CONTROL)
        if (control !== null && listRef.current?.contains(control) !== true) {
          return
        }
      }
      handleKeyDown(event)
    }

    // Capture so the list responds without requiring focus inside the card. Also why the div's
    // onKeyDown is removed rather than kept: with both attached, a keypress while focus is inside
    // the list would fire this listener and then bubble to the div, moving the highlight twice.
    window.addEventListener('keydown', handleWindowKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleWindowKeyDown, { capture: true })
  }, [activation, disabled, handleKeyDown, keyboardScope, options.length])

  return (
    <div
      className="flex flex-col"
      onKeyDown={keyboardScope === 'container' && !disabled ? handleKeyDown : undefined}
      ref={listRef}
    >
      {options.map((option, index) => {
        const isSelected = selected.includes(rowKey(option))
        const isActive = highlightActive && activeIndex === index
        const nextOption = options[index + 1]
        const isNextHighlighted =
          (nextOption !== undefined && selected.includes(rowKey(nextOption))) ||
          (highlightActive && activeIndex === index + 1)
        const dividerHidden =
          !dividers || isDividerHiddenBetween(isSelected || isActive, isNextHighlighted)
        const rowEndIcon =
          option.endIcon === undefined ? (
            activation === 'immediate' && isActive ? (
              <CornerDownLeft aria-hidden className="size-4.5" />
            ) : undefined
          ) : (
            option.endIcon
          )

        const row = (
          <OptionRow
            active={isActive}
            activeBadgeClassName={activeBadgeClassName}
            badge={option.badge ?? String.fromCharCode(65 + index)}
            description={option.description}
            disabled={disabled || option.disabled === true}
            endIcon={rowEndIcon}
            label={option.label}
            onConfirm={
              activation === 'confirm' && onConfirm
                ? () => onConfirm(option.label, option)
                : undefined
            }
            onFocus={() => setActiveIndex(index)}
            onMouseEnter={() => setActiveIndex(index)}
            onSelect={() => onSelect(option.label, option)}
            ref={registerRowRef(index)}
            selected={isSelected}
          />
        )

        return (
          <Fragment key={rowKey(option)}>
            {rowTestId ? <div data-testid={rowTestId(option)}>{row}</div> : row}
            {index < options.length - 1 ? <OptionDivider hidden={dividerHidden} /> : null}
          </Fragment>
        )
      })}
      {trailing}
    </div>
  )
}

/** Row identity: `id` when a surface has real ids, else the label. Also the selection key. */
function rowKey(row: OptionListRow) {
  return row.id ?? row.label
}
