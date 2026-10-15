'use client'

import * as SliderPrimitive from '@radix-ui/react-slider'
import * as React from 'react'

import { cn } from '../../lib/utils'

type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  /** How much is loaded, in percent of the track; drawn only with `showBuffer`. */
  bufferProgress?: number
  hideThumb?: boolean
  rangeClassName?: string
  showBuffer?: boolean
  thumbClassName?: string
  trackClassName?: string
  trackStyle?: React.CSSProperties
}

/**
 * Single-thumb slider for a number, e.g. a video's play position.
 *
 * @example
 * <Slider max={100} onValueChange={([v]) => seek(v)} value={[position]} />
 */
const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  (
    {
      bufferProgress = 0,
      className,
      hideThumb,
      rangeClassName,
      showBuffer,
      thumbClassName,
      trackClassName,
      trackStyle,
      ...props
    },
    ref,
  ) => (
    <SliderPrimitive.Root
      className={cn(
        'relative flex w-full cursor-pointer touch-none select-none items-center',
        className,
      )}
      ref={ref}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          'relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20',
          trackClassName,
        )}
        style={trackStyle}
      >
        <SliderPrimitive.Range
          className={cn('absolute h-full rounded-full bg-primary', rangeClassName)}
        />
        {showBuffer && (
          <SliderPrimitive.Range
            className="absolute h-full rounded-full bg-primary/10"
            style={{ width: `${bufferProgress}%` }}
          />
        )}
      </SliderPrimitive.Track>
      {!hideThumb && (
        <SliderPrimitive.Thumb
          className={cn(
            'block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:pointer-events-none disabled:opacity-50',
            thumbClassName,
          )}
        />
      )}
    </SliderPrimitive.Root>
  ),
)
Slider.displayName = 'Slider'

export { Slider, type SliderProps }
