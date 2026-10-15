import React from 'react'

import { SemiArrowLeft } from '@/components/icons/core'

interface DrawerSubPageHeaderProps {
  onBack: () => void
  title: string
}

export const DrawerSubPageHeader: React.FC<DrawerSubPageHeaderProps> = ({ title, onBack }) => (
  <div className="relative h-9 mb-3">
    <button
      className="absolute left-4 top-0 size-9.5 flex items-center justify-center rounded-full bg-fill-secondary backdrop-blur-2xl"
      onClick={onBack}
    >
      <SemiArrowLeft className="size-4 text-primary" />
    </button>
    <span className="absolute left-1/2 -translate-x-1/2 top-2 text-primary text-base font-medium">
      {title}
    </span>
  </div>
)
