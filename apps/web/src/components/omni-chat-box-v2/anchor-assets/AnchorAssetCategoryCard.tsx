'use client'

import { Button, cn } from '@shared/ui'
import type { ReactNode } from 'react'

import type { AnchorAssetCategory } from './anchor-assets.types'

type AnchorAssetCategoryCardProps = {
  category: AnchorAssetCategory
  disabled?: boolean
  icon: ReactNode
  label: string
  onClick: (category: AnchorAssetCategory) => void
}

export function AnchorAssetCategoryCard({
  category,
  disabled = false,
  icon,
  label,
  onClick,
}: AnchorAssetCategoryCardProps) {
  return (
    <Button
      aria-label={`Upload ${label}`}
      className={cn(
        'h-20 w-[60px] min-w-[60px] rounded-[8px] bg-white/10 p-1.5 hover:bg-white/[0.16]',
        'flex flex-col items-start justify-between transition-colors',
      )}
      disabled={disabled}
      onClick={() => onClick(category)}
      variant="secondary"
    >
      <span className="mt-0.5">{icon}</span>
      <span className="pb-0.5 text-xs font-medium leading-[15px] text-white">{label}</span>
    </Button>
  )
}
