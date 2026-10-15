'use client'

import { cn } from '@shared/ui'
import React, { PropsWithChildren } from 'react'

type LayerContainerProps = {
  className?: string
  style?: React.CSSProperties
}

const LayerContainer: React.FC<PropsWithChildren<LayerContainerProps>> = ({
  children,
  className,
  style,
}) => {
  return (
    <div
      className={cn(
        'relative flex-1 flex flex-col h-full min-h-0 w-full box-border overflow-hidden',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  )
}

LayerContainer.displayName = 'LayerContainer'

export default LayerContainer
