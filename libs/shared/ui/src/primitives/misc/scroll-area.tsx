'use client'

import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as React from 'react'

import { cn } from '../../lib/utils'

type ScrollAreaProps = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
  barClassName?: string
  barStyle?: React.CSSProperties
  /** Inside a dialog: let the content overflow the root and push the bar into the dialog's padding. */
  inDialog?: boolean
  onViewportScroll?: React.UIEventHandler<HTMLDivElement>
  orientation?: 'horizontal' | 'vertical'
  /** Ref to the element that actually scrolls. */
  scrollerRef?: React.Ref<HTMLDivElement>
  viewPortClassName?: string
  viewportId?: string
}

/** Thin themed scrollbar for a ScrollArea. */
const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    className={cn(
      'flex touch-none select-none transition-colors',
      orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-[1px]',
      orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-[1px]',
      className,
    )}
    orientation={orientation}
    ref={ref}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = 'ScrollBar'

/**
 * Scrollable box with a slim themed scrollbar in place of the browser's.
 *
 * @example
 * <ScrollArea className="h-40">
 *   <p>Long content...</p>
 * </ScrollArea>
 */
const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(
  (
    {
      barClassName,
      barStyle,
      children,
      className,
      inDialog,
      onViewportScroll,
      orientation = 'vertical',
      scrollerRef,
      viewPortClassName,
      viewportId,
      ...props
    },
    ref,
  ) => (
    <ScrollAreaPrimitive.Root
      className={cn('relative', !inDialog && 'overflow-hidden', className)}
      ref={ref}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        className={cn('h-full w-full rounded-[inherit]', viewPortClassName)}
        id={viewportId}
        onScroll={onViewportScroll}
        ref={scrollerRef}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar
        className={cn(inDialog && 'right-[-24px!important]', barClassName)}
        orientation={orientation}
        style={barStyle}
      />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  ),
)
ScrollArea.displayName = 'ScrollArea'

export { ScrollArea, type ScrollAreaProps }
