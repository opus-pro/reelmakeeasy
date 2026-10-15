import { debounce } from 'lodash-es'
import React, { RefObject, useEffect, useRef, useState } from 'react'

export interface UseIntersectionObserverOptions {
  /** Debounce delay in ms. Default 100 */
  debounceMs?: number
  /** Enable/disable the observer. Default true */
  enabled?: boolean
  /** Callback when intersection state changes */
  onIntersect?: (isIntersecting: boolean) => void
  /** Intersection root margin, same syntax as IntersectionObserver. Default '0px' */
  rootMargin?: string
  /** Visibility threshold (0-1), default 0.5 */
  threshold?: number
  /** If false, only track entering viewport (one-way). If true, track both enter and leave. Default true */
  toggle?: boolean
}

/**
 * Hook to observe element intersection with viewport
 */
type VisibilityComponentProps = {
  children: (visible: boolean) => React.ReactNode
  className?: string
  debounceMs?: number
  rootMargin?: string
  threshold?: number
  toggle?: boolean
}

export function useIntersectionObserver(
  ref: RefObject<Element | null>,
  options: UseIntersectionObserverOptions = {},
): boolean {
  const {
    threshold = 0.5,
    toggle = true,
    debounceMs = 100,
    enabled = true,
    onIntersect,
    rootMargin = '0px',
  } = options
  const [isVisible, setIsVisible] = useState(false)
  const onIntersectRef = useRef(onIntersect)

  useEffect(() => {
    onIntersectRef.current = onIntersect
  }, [onIntersect])

  useEffect(() => {
    // Reset state when disabled to prevent stale values
    if (!enabled) {
      setIsVisible(false)
      return
    }

    const element = ref.current
    if (!element) {
      return
    }

    const handleIntersection = debounce((entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (toggle) {
          setIsVisible(entry.isIntersecting)
        } else {
          if (entry.isIntersecting) {
            setIsVisible(true)
          }
        }
        // Call onIntersect callback with intersection state
        onIntersectRef.current?.(entry.isIntersecting)
      })
    }, debounceMs)

    const observer = new IntersectionObserver(handleIntersection, {
      root: null,
      rootMargin,
      threshold,
    })

    observer.observe(element)

    return () => {
      handleIntersection.cancel()
      observer.disconnect()
    }
  }, [ref, threshold, toggle, debounceMs, enabled, rootMargin])

  return isVisible
}

const VisibilityComponent: React.FC<VisibilityComponentProps> = ({
  children,
  threshold = 0.5,
  toggle = true,
  className,
  debounceMs,
  rootMargin,
}) => {
  const elementRef = useRef<HTMLDivElement>(null)
  const isVisible = useIntersectionObserver(elementRef, {
    threshold,
    toggle,
    debounceMs,
    rootMargin,
  })

  return (
    <div className={className} ref={elementRef}>
      {children(isVisible)}
    </div>
  )
}

export default VisibilityComponent
