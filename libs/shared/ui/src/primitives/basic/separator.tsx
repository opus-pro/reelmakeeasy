'use client'

import * as SeparatorPrimitive from '@radix-ui/react-separator'
import * as React from 'react'

import { cn } from '../../lib/utils'

/**
 * Thin line between sections. Decorative (hidden from screen readers) unless `decorative={false}`.
 *
 * @example
 * <Separator orientation="vertical" />
 */
const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, decorative = true, orientation = 'horizontal', ...props }, ref) => (
  <SeparatorPrimitive.Root
    className={cn(
      'shrink-0 bg-border',
      orientation === 'vertical' ? 'h-full w-[1px]' : 'h-[1px] w-full',
      className,
    )}
    decorative={decorative}
    orientation={orientation}
    ref={ref}
    {...props}
  />
))
Separator.displayName = 'Separator'

export { Separator }
