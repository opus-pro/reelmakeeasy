import { cn } from '@shared/ui'
import React from 'react'

import { getStyleTextSnippet, type TextStyleVisualProps } from './story-mode-panel-helpers'

export const TextStyleVisual: React.FC<TextStyleVisualProps> = ({ mode, styleText }) => {
  const snippet = getStyleTextSnippet(mode, styleText)

  return (
    <div className="relative size-full overflow-hidden rounded-sm bg-[linear-gradient(150deg,#2f3a4f_0%,#3a455e_58%,#463f57_100%)] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(255,255,255,0.26),transparent_48%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.04)_0%,rgba(0,0,0,0.3)_100%)]" />
      <div
        className={cn(
          'relative flex size-full items-start p-2.5',
          mode === 'preview' ? 'pt-3 pb-10' : 'pt-2.5 pb-2',
        )}
      >
        <p
          className={cn(
            'font-medium text-white/95 break-words text-left',
            mode === 'thumbnail'
              ? 'line-clamp-3 text-[10px] leading-[13px]'
              : 'line-clamp-5 text-[12px] leading-[15px]',
          )}
        >
          {snippet}
        </p>
      </div>
    </div>
  )
}
