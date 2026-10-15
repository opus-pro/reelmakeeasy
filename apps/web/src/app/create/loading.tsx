'use client'

import { cn } from '@shared/ui'
import { useSearchParams } from 'next/navigation'

import { CREATE_USE_CASE_QUERY_PARAM, CREATE_USE_CASES } from '@/constants/create-use-cases'

/**
 * Full-bleed shimmer fallback for the /create segment, so tapping the create CTA
 * paints instantly instead of a frozen dead-click while the route resolves.
 *
 * /create renders one of two mobile layouts, decided by the `create` query param
 * exactly as DashboardV2's `hasValidCreateUseCaseQuery` does: a valid use-case
 * key opens MobileCreateSheet directly; anything else shows CreateUseCaseGrid
 * first. We read the same param here (client component) and render the matching
 * skeleton so the fallback lines up with what mounts.
 *
 * These layouts only mount below the `md` breakpoint (DashboardV2 gates them on
 * `isBelowMd`, i.e. narrower than 768px). Both skeletons are therefore `md:hidden`
 * so they never paint on desktop, where /create redirects home instead - rendering
 * the full-bleed overlay there is a visual mismatch.
 */
export default function CreateLoading() {
  const searchParams = useSearchParams()
  const useCaseKey = searchParams.get(CREATE_USE_CASE_QUERY_PARAM)
  const showsSheet = CREATE_USE_CASES.some((useCase) => useCase.key === useCaseKey)
  return showsSheet ? <CreateSheetSkeleton /> : <CreateUseCaseGridSkeleton />
}

/** Mirrors MobileCreateSheet: header, prompt area + 3-up action tiles, chips, CTA. */
function CreateSheetSkeleton() {
  return (
    <div
      aria-busy
      className="fixed inset-0 z-[70] flex flex-col gap-3 bg-panel px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] md:hidden"
    >
      <span className="sr-only">Loading create…</span>

      {/* Header: use-case pill + settings / close icons */}
      <div className="flex shrink-0 items-center justify-between">
        <ShimmerBlock className="h-9 w-40 rounded-full" />
        <div className="flex items-center gap-2">
          <ShimmerBlock className="size-9 rounded-full" />
          <ShimmerBlock className="size-9 rounded-full" />
        </div>
      </div>

      {/* Body: 3-up action tiles + prompt input area */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid shrink-0 grid-cols-3 gap-2">
          <ShimmerBlock className="h-[100px] rounded-3xl" />
          <ShimmerBlock className="h-[100px] rounded-3xl" />
          <ShimmerBlock className="h-[100px] rounded-3xl" />
        </div>
        <ShimmerBlock className="flex-1 rounded-2xl" />
      </div>

      {/* Footer: settings chips + create button */}
      <div className="flex shrink-0 flex-col gap-4">
        <div className="flex gap-2">
          <ShimmerBlock className="h-8 w-24 rounded-full" />
          <ShimmerBlock className="h-8 w-20 rounded-full" />
          <ShimmerBlock className="h-8 w-16 rounded-full" />
        </div>
        <ShimmerBlock className="h-12 w-full rounded-full" />
      </div>
    </div>
  )
}

/** Mirrors CreateUseCaseGrid: "Create" header + close, two-column cards (square thumb + title). */
function CreateUseCaseGridSkeleton() {
  return (
    <div aria-busy className="fixed inset-0 z-[70] flex flex-col gap-4 bg-panel p-4 md:hidden">
      <span className="sr-only">Loading create…</span>

      {/* Header: title + close */}
      <div className="flex shrink-0 items-center justify-between">
        <ShimmerBlock className="h-5 w-20 rounded-md" />
        <ShimmerBlock className="size-9 rounded-full" />
      </div>

      {/* Use-case cards */}
      <div className="flex flex-1 flex-wrap gap-2.5 overflow-hidden">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            className="flex w-[calc(50%-5px)] shrink-0 flex-col justify-between gap-2.5 rounded-2xl bg-white/10 p-3"
            key={`create-skeleton-card-${index}`}
          >
            <ShimmerBlock className="aspect-square w-full shrink-0 rounded-lg" />
            <ShimmerBlock className="h-5 w-2/3 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ShimmerBlock({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-white/10', className)}>
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent bg-[length:200%_100%]" />
    </div>
  )
}
