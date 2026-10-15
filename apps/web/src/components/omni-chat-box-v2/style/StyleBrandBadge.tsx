'use client'

import { Tooltip } from '@shared/ui'

import { BrandKit } from '@/components/icons/core'

import { brandUsageLabel } from '../brand/brand-style-usage-helpers'

export function StyleBrandBadge({ names }: { names: string[] }) {
  if (names.length === 0) {
    return null
  }
  return (
    <>
      <div
        className="absolute inset-x-0 bottom-0 z-10 h-10"
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.48) 50%)' }}
      />
      <Tooltip
        className="bg-menu text-white rounded-xs p-1.5 text-label-sm"
        content={brandUsageLabel(names)}
        side="top"
      >
        <div
          className="absolute bottom-1.5 right-1.5 z-20 flex size-5 items-center justify-center text-secondary"
          data-testid="style-brand-badge"
          onClick={(event) => event.stopPropagation()}
        >
          <BrandKit className="size-5 drop-shadow-[0_0_16px_rgba(0,0,0,0.25)]" />
        </div>
      </Tooltip>
    </>
  )
}
