'use client'

import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as React from 'react'

import { cn } from '../../lib/utils'

/** Root of a hand-built popover: holds the open state. */
const PopoverRoot = PopoverPrimitive.Root

/** Element that opens the popover. */
const PopoverTrigger = PopoverPrimitive.Trigger

/** Element (or `virtualRef`) the popover is placed against, when that is not the trigger. */
const PopoverAnchor = PopoverPrimitive.Anchor

// A modal Dialog's scroll lock cancels wheel/touch scrolling on anything outside the dialog,
// which includes a popover portaled to <body>. Stopping the event at the popover keeps it
// away from the lock's document listener, so the popover's own content still scrolls.
const stopScrollEvent = (event: React.SyntheticEvent) => event.stopPropagation()

/** The floating panel, portaled to `document.body` (or `container`). */
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    container?: HTMLElement | null
  }
>(
  (
    { align = 'center', className, container, onTouchMove, onWheel, sideOffset = 4, ...props },
    ref,
  ) => (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        align={align}
        className={cn(
          'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        onTouchMove={(event) => {
          stopScrollEvent(event)
          onTouchMove?.(event)
        }}
        onWheel={(event) => {
          stopScrollEvent(event)
          onWheel?.(event)
        }}
        ref={ref}
        sideOffset={sideOffset}
        {...props}
      />
    </PopoverPrimitive.Portal>
  ),
)
PopoverContent.displayName = 'PopoverContent'

type ContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>

/** Props of the one-piece Popover: the trigger as children, the panel as `content`. */
interface PopoverProps
  extends Pick<
    ContentProps,
    | 'align'
    | 'alignOffset'
    | 'avoidCollisions'
    | 'collisionBoundary'
    | 'collisionPadding'
    | 'onInteractOutside'
    | 'onOpenAutoFocus'
    | 'side'
    | 'sideOffset'
  > {
  /** Draws a small triangle pointing at the trigger. */
  arrow?: boolean
  /** Replaces the default triangle when `arrow` is set. */
  arrowContent?: React.ReactElement
  /** The trigger: a single element. */
  children?: React.ReactNode
  className?: string
  classNames?: Partial<Record<'arrow', string>>
  content?: React.ReactNode
  /** Traps focus and blocks the rest of the page while open. */
  modal?: boolean
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  onOpenChange?: (open: boolean) => void
  onPointerDownOutside?: (event: Event) => void
  open?: boolean
  /** Element the panel is portaled into. Defaults to `document.body`. */
  portalContainer?: HTMLElement | null
  /** Renders a custom trigger; gets the trigger component to compose with. */
  renderTrigger?: (trigger: typeof PopoverTrigger) => React.ReactNode
  style?: React.CSSProperties
}

/**
 * One-piece popover: the child element opens a floating panel showing `content`.
 *
 * @example
 * <Popover content={<Menu />} onOpenChange={setOpen} open={open} side="bottom">
 *   <button type="button">Open</button>
 * </Popover>
 */
const Popover = React.forwardRef<HTMLDivElement, PopoverProps>(
  (
    {
      arrow,
      arrowContent,
      children,
      className,
      classNames,
      content,
      modal,
      onOpenChange,
      open,
      portalContainer,
      renderTrigger,
      ...contentProps
    },
    ref,
  ) => (
    <PopoverRoot modal={modal} onOpenChange={onOpenChange} open={open}>
      {renderTrigger ? (
        renderTrigger(PopoverTrigger)
      ) : (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      )}
      <PopoverContent
        className={cn('border-border font-sans', arrow && 'border-none', className)}
        container={portalContainer}
        ref={ref}
        {...contentProps}
      >
        {content}
        {arrow &&
          (arrowContent ? (
            <PopoverPrimitive.Arrow asChild>{arrowContent}</PopoverPrimitive.Arrow>
          ) : (
            <PopoverPrimitive.Arrow
              className={cn('fill-popover', classNames?.arrow)}
              height={20}
              width={24}
            />
          ))}
      </PopoverContent>
    </PopoverRoot>
  ),
)
Popover.displayName = 'Popover'

export { Popover, PopoverAnchor, PopoverContent, type PopoverProps, PopoverRoot, PopoverTrigger }
