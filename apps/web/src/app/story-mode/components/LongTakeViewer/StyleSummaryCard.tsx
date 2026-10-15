import { cn } from '@shared/ui'

import { ModelBadges, type ModelBadgesProps } from './ModelBadges'

export interface StyleSummaryCardProps extends ModelBadgesProps {
  infoPills?: string[]
  isMobile?: boolean
  styleName?: string
  thumbnailUrl?: string
}

// DetailPanel's Style/tags/model summary card.
export function StyleSummaryCard({
  infoPills = [],
  isMobile,
  styleName,
  thumbnailUrl,
  videoModel,
}: StyleSummaryCardProps) {
  return (
    <div
      className={cn(
        'self-stretch flex shrink-0 flex-col gap-5 overflow-hidden rounded-2xl bg-[#2a2a2a]',
        isMobile ? 'p-4' : 'p-6',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0 w-[50px] h-[68px] rounded-sm overflow-hidden">
          {thumbnailUrl ? (
            <img
              alt={`${styleName} style`}
              className="size-full object-cover"
              fetchPriority="high"
              src={thumbnailUrl}
            />
          ) : (
            // Orange gradient placeholder for custom style
            <div className="size-full bg-gradient-to-br from-amber-600 via-accent-orange to-red-500" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs text-secondary">Style</p>
          <p className="text-base font-semibold text-primary">{styleName}</p>
        </div>
      </div>

      {(infoPills.length > 0 || videoModel !== undefined) && (
        <div className="flex flex-wrap items-center gap-2">
          {infoPills.map((pill) => (
            <span
              className="flex h-[30px] items-center justify-center rounded-sm bg-fill-secondary px-2 text-sm font-medium leading-tight text-primary"
              key={pill}
            >
              {pill}
            </span>
          ))}
          <ModelBadges videoModel={videoModel} />
        </div>
      )}
    </div>
  )
}
