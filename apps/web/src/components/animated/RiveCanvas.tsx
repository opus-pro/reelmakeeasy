'use client'

import {
  type Event as RiveEvent,
  type EventCallback,
  Rive,
  useRive,
  UseRiveParameters,
} from '@rive-app/react-canvas'
import { cn } from '@shared/ui'
import { forwardRef, useCallback, useImperativeHandle, useState } from 'react'

export interface RiveCanvasRef {
  /** Whether the Rive animation is loaded */
  isLoaded: boolean
  /** The Rive instance (null if not loaded) */
  rive: null | Rive
}

/** Custom error type for Rive load failures, with original event attached for debugging */

type RiveCanvasProps = Omit<NonNullable<UseRiveParameters>, 'onLoad' | 'onLoadError'> & {
  /** Additional class names for the wrapper */
  className?: string
  /** Callback when the animation is loaded */
  onLoad?: () => void
  /** Callback when the animation fails to load */
  onLoadError?: (error: RiveEvent) => void
  /** Whether to show a loading skeleton (default: true) */
  showLoadingSkeleton?: boolean
}

const RiveCanvas = forwardRef<RiveCanvasRef, RiveCanvasProps>(
  ({ className, onLoad, onLoadError, showLoadingSkeleton = true, ...riveParams }, ref) => {
    const [isLoaded, setIsLoaded] = useState(false)

    const handleLoad = useCallback(() => {
      setIsLoaded(true)
      onLoad?.()
    }, [onLoad])

    const handleLoadError: EventCallback = useCallback(
      (event) => {
        onLoadError?.(event)
      },
      [onLoadError],
    )

    const { RiveComponent, rive } = useRive({
      ...riveParams,
      onLoad: handleLoad,
      onLoadError: handleLoadError,
    })

    useImperativeHandle(
      ref,
      () => ({
        isLoaded,
        rive,
      }),
      [isLoaded, rive],
    )

    return (
      <div className={cn('relative size-full', className)}>
        {!isLoaded && showLoadingSkeleton && (
          <div className="absolute inset-0 animate-pulse rounded-sm bg-fill-secondary" />
        )}
        <div className={cn('size-full', isLoaded ? 'opacity-100' : 'opacity-0')}>
          <RiveComponent />
        </div>
      </div>
    )
  },
)

RiveCanvas.displayName = 'RiveCanvas'

export default RiveCanvas
