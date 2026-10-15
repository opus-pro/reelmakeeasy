'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'

import { cn } from '../../lib/utils'

type ContentProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>

/** Props of the Tooltip wrapper: a trigger element plus the hint shown for it. */
export interface TooltipProps {
  align?: ContentProps['align']
  alignOffset?: ContentProps['alignOffset']
  /** Draws a small triangle pointing at the trigger. */
  arrow?: boolean
  /** Extra classes for the arrow. */
  arrowClassName?: string
  /** The element the tooltip is attached to. Must be a single element. */
  children: React.ReactNode
  /** Extra classes for the tooltip box. */
  className?: string
  collisionBoundary?: ContentProps['collisionBoundary']
  collisionPadding?: ContentProps['collisionPadding']
  /** What the tooltip shows. When empty, only `children` is rendered. */
  content?: React.ReactNode
  /** Starts open when the open state is not controlled. */
  defaultOpen?: boolean
  delayDuration?: number
  /** Disables the trigger element. */
  disabled?: boolean
  disableHoverableContent?: boolean
  /** Lets a click on the trigger close the tooltip (by default a click keeps it as it is). */
  disablePersistedActivation?: boolean
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  /** Called when the tooltip asks to open or close. */
  onOpenChange?: (open: boolean) => void
  /** Controlled open state. */
  open?: boolean
  /** Renders the tooltip in a portal at the end of the page instead of next to the trigger. */
  portal?: boolean
  side?: ContentProps['side']
  sideOffset?: ContentProps['sideOffset']
  /** Open on hover or on click. Defaults to hover, or click on narrow (phone) screens. */
  trigger?: 'click' | 'hover'
}

const DEFAULT_DELAY_MS = 100

// Phones get click-to-open tooltips: there is no hover on a touch screen.
const NARROW_SCREEN_QUERY = '(max-width: 640px)'

function getNarrowScreenQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(NARROW_SCREEN_QUERY)
}

function isNarrowScreen() {
  return getNarrowScreenQuery()?.matches ?? false
}

function subscribeToNarrowScreen(onChange: () => void) {
  const query = getNarrowScreenQuery()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

const useIsNarrowScreen = () =>
  React.useSyncExternalStore(subscribeToNarrowScreen, isNarrowScreen, () => false)

const TOOLTIP_BOX_CLASSES = cn(
  'z-tooltip max-w-sm overflow-hidden rounded-md bg-primary px-3 py-1.5',
  'text-left font-sans text-xs font-medium text-primary-foreground',
  'animate-in fade-in-0 zoom-in-95',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
)

/**
 * A hint attached to one trigger element. Opens on hover (desktop) or on click
 * (phones, or `trigger="click"`). Clicking the trigger leaves a hover tooltip
 * as it is unless `disablePersistedActivation` is set.
 *
 * @example
 * <Tooltip content="Copy link">
 *   <button type="button">Copy</button>
 * </Tooltip>
 */
const Tooltip = ({
  align,
  alignOffset,
  arrow,
  arrowClassName,
  children,
  className,
  collisionBoundary,
  collisionPadding,
  content,
  defaultOpen = false,
  delayDuration,
  disabled,
  disableHoverableContent,
  disablePersistedActivation,
  onClick,
  onOpenChange,
  open,
  portal,
  side,
  sideOffset = 4,
  trigger,
}: TooltipProps) => {
  const isNarrowScreen = useIsNarrowScreen()
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  // Only click tooltips keep their own open state (each click flips it; the
  // `open` prop, when given, still decides what is shown). Hover tooltips leave
  // it to Radix or to the `open` prop.
  const [clickOpen, setClickOpen] = React.useState(defaultOpen)
  const opensOnClick = (trigger ?? (isNarrowScreen ? 'click' : 'hover')) === 'click'

  const changeClickOpen = (next: boolean) => {
    setClickOpen(next)
    onOpenChange?.(next)
  }

  const handleTriggerClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    // A prevented click stops Radix from closing the tooltip on click.
    if (!disablePersistedActivation) event.preventDefault()
    if (opensOnClick) changeClickOpen(!clickOpen)
  }

  // A press on the trigger is not a press outside: the trigger's own handlers
  // deal with it. Any other press closes a click tooltip.
  const handlePointerDownOutside = (event: Event) => {
    if (event.target instanceof Node && triggerRef.current?.contains(event.target)) {
      event.preventDefault()
      return
    }
    if (opensOnClick) changeClickOpen(false)
  }

  if (!content) return <>{children}</>

  const box = (
    <TooltipPrimitive.Content
      align={align}
      alignOffset={alignOffset}
      className={cn(TOOLTIP_BOX_CLASSES, arrow && 'overflow-visible', className)}
      collisionBoundary={collisionBoundary}
      collisionPadding={collisionPadding}
      onPointerDownOutside={handlePointerDownOutside}
      side={side}
      sideOffset={sideOffset}
    >
      {content}
      {arrow && <TooltipPrimitive.Arrow className={cn('fill-primary', arrowClassName)} />}
    </TooltipPrimitive.Content>
  )

  // Each tooltip brings its own provider, so it works anywhere and always
  // waits DEFAULT_DELAY_MS (or `delayDuration`) before opening on hover.
  // Radix still reports its own open/close requests (hover, focus, Escape)
  // through onOpenChange; a click tooltip does not act on them.
  return (
    <TooltipPrimitive.Provider delayDuration={DEFAULT_DELAY_MS}>
      <TooltipPrimitive.Root
        defaultOpen={defaultOpen}
        delayDuration={delayDuration}
        disableHoverableContent={disableHoverableContent}
        onOpenChange={onOpenChange}
        open={opensOnClick ? (open ?? clickOpen) : open}
      >
        <TooltipPrimitive.Trigger
          asChild
          disabled={disabled}
          onClick={handleTriggerClick}
          ref={triggerRef}
        >
          {children}
        </TooltipPrimitive.Trigger>
        {portal ? <TooltipPrimitive.Portal>{box}</TooltipPrimitive.Portal> : box}
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

/**
 * Radix tooltip provider with a 100ms default delay. Tooltip already brings
 * its own, so wrapping the app in this is optional.
 */
const TooltipProvider = ({
  delayDuration = DEFAULT_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
)

export { Tooltip, TooltipProvider }
