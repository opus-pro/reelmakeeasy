import { cn } from '../lib/utils'

/** Whether the divider between two adjacent rows should go transparent, given each row's own highlighted (selected/active) state. */
export function isDividerHiddenBetween(rowHighlighted: boolean, nextRowHighlighted: boolean) {
  return rowHighlighted || nextRowHighlighted
}

/** 1px separator between adjacent option rows; stays in the layout but goes transparent near a selected, active, or hovered neighbor. */
export function OptionDivider({ hidden }: { hidden: boolean }) {
  return (
    <div
      className={cn('border-t transition-colors', hidden ? 'border-transparent' : 'border-subtle')}
    />
  )
}
