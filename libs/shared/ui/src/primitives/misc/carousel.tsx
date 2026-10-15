'use client'

import useEmblaCarousel, { type UseEmblaCarouselType } from 'embla-carousel-react'
import * as React from 'react'

import { cn } from '../../lib/utils'

/** The Embla API of a Carousel (scrollTo, on('select'), ...). */
type CarouselApi = UseEmblaCarouselType[1]
type CarouselContextValue = {
  api: CarouselApi
  canScrollNext: boolean
  canScrollPrev: boolean
  carouselRef: UseEmblaCarouselType[0]
  opts?: CarouselOptions
  orientation: 'horizontal' | 'vertical'
  scrollNext: () => void
  scrollPrev: () => void
  scrollTo: (index: number) => void
  selectedIndex: number
}
type CarouselOptions = UseCarouselParameters[0]
type CarouselPlugin = UseCarouselParameters[1]

type CarouselProps = {
  /** Turns off the ArrowLeft/ArrowRight keys. */
  disableKeydown?: boolean
  opts?: CarouselOptions
  orientation?: 'horizontal' | 'vertical'
  plugins?: CarouselPlugin
  setApi?: (api: CarouselApi) => void
}

type UseCarouselParameters = Parameters<typeof useEmblaCarousel>

const CarouselContext = React.createContext<CarouselContextValue | null>(null)

/** Scroll state and controls of the surrounding `<Carousel>`. */
function useCarousel(): CarouselContextValue {
  const context = React.useContext(CarouselContext)
  if (!context) {
    throw new Error('useCarousel must be used within a <Carousel />')
  }
  return context
}

/**
 * Swipeable row (or column) of slides.
 *
 * @example
 * <Carousel opts={{ loop: false }} setApi={setApi}>
 *   <CarouselContent>
 *     <CarouselItem>Slide 1</CarouselItem>
 *     <CarouselItem>Slide 2</CarouselItem>
 *   </CarouselContent>
 * </Carousel>
 */
const Carousel = React.forwardRef<
  HTMLDivElement,
  CarouselProps & React.HTMLAttributes<HTMLDivElement>
>(
  (
    {
      children,
      className,
      disableKeydown,
      onKeyDownCapture,
      opts,
      orientation,
      plugins,
      setApi,
      ...props
    },
    ref,
  ) => {
    const axisOrientation = orientation ?? (opts?.axis === 'y' ? 'vertical' : 'horizontal')
    const [carouselRef, api] = useEmblaCarousel(
      { ...opts, axis: axisOrientation === 'horizontal' ? 'x' : 'y' },
      plugins,
    )
    const [canScrollPrev, setCanScrollPrev] = React.useState(false)
    const [canScrollNext, setCanScrollNext] = React.useState(false)
    const [selectedIndex, setSelectedIndex] = React.useState(0)

    const onSelect = React.useCallback((current: CarouselApi) => {
      if (!current) {
        return
      }
      setSelectedIndex(current.selectedScrollSnap())
      setCanScrollPrev(current.canScrollPrev())
      setCanScrollNext(current.canScrollNext())
    }, [])

    const scrollPrev = React.useCallback(() => api?.scrollPrev(), [api])
    const scrollNext = React.useCallback(() => api?.scrollNext(), [api])
    const scrollTo = React.useCallback((index: number) => api?.scrollTo(index), [api])

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        onKeyDownCapture?.(event)
        if (disableKeydown) {
          return
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          scrollPrev()
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          scrollNext()
        }
      },
      [disableKeydown, onKeyDownCapture, scrollNext, scrollPrev],
    )

    React.useEffect(() => {
      if (api && setApi) {
        setApi(api)
      }
    }, [api, setApi])

    React.useEffect(() => {
      if (!api) {
        return
      }
      onSelect(api)
      api.on('reInit', onSelect)
      api.on('select', onSelect)
      return () => {
        api.off('reInit', onSelect)
        api.off('select', onSelect)
      }
    }, [api, onSelect])

    const value = React.useMemo<CarouselContextValue>(
      () => ({
        api,
        canScrollNext,
        canScrollPrev,
        carouselRef,
        opts,
        orientation: axisOrientation,
        scrollNext,
        scrollPrev,
        scrollTo,
        selectedIndex,
      }),
      [
        api,
        axisOrientation,
        canScrollNext,
        canScrollPrev,
        carouselRef,
        opts,
        scrollNext,
        scrollPrev,
        scrollTo,
        selectedIndex,
      ],
    )

    return (
      <CarouselContext.Provider value={value}>
        <div
          aria-roledescription="carousel"
          className={cn('relative', className)}
          id="carousel-container"
          onKeyDownCapture={handleKeyDown}
          ref={ref}
          role="region"
          {...props}
        >
          {children}
        </div>
      </CarouselContext.Provider>
    )
  },
)
Carousel.displayName = 'Carousel'

/** The scrolling strip that holds the slides. `wrapperClassName` styles its clipping box. */
const CarouselContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { wrapperClassName?: string }
>(({ className, wrapperClassName, ...props }, ref) => {
  const { carouselRef, orientation } = useCarousel()
  return (
    <div className={cn('w-full overflow-hidden', wrapperClassName)} ref={carouselRef}>
      <div
        className={cn('flex', orientation === 'horizontal' ? '-ml-5' : '-mt-4 flex-col', className)}
        ref={ref}
        {...props}
      />
    </div>
  )
})
CarouselContent.displayName = 'CarouselContent'

/** One slide. */
const CarouselItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { orientation } = useCarousel()
    return (
      <div
        aria-roledescription="slide"
        className={cn(
          'min-w-0 shrink-0 grow-0 basis-full',
          orientation === 'horizontal' ? 'pl-4' : 'pt-4',
          className,
        )}
        ref={ref}
        role="group"
        {...props}
      />
    )
  },
)
CarouselItem.displayName = 'CarouselItem'

export { Carousel, type CarouselApi, CarouselContent, CarouselItem, useCarousel }
