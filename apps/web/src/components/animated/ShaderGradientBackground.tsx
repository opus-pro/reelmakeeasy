'use client'

import '@react-spring/three'

import { type GradientT, ShaderGradient, ShaderGradientCanvas } from '@shadergradient/react'
import { cn } from '@shared/ui'
import { memo } from 'react'

export type ShaderGradientBackgroundProps =
  | ({ canvasStyle?: React.CSSProperties; className?: string } & {
      gradientProps: GradientT
      urlString?: never
    })
  | ({ canvasStyle?: React.CSSProperties; className?: string } & {
      gradientProps?: never
      urlString: string
    })

const ShaderGradientBackground: React.FC<ShaderGradientBackgroundProps> = ({
  className,
  canvasStyle,
  urlString,
  gradientProps,
}) => {
  return (
    <div className={cn('relative', className)}>
      <ShaderGradientCanvas
        style={
          canvasStyle ?? {
            position: 'absolute',
            inset: 0,
          }
        }
      >
        {urlString ? (
          <ShaderGradient control="query" urlString={urlString} />
        ) : (
          <ShaderGradient {...(gradientProps ?? { cDistance: 32, cPolarAngle: 125 })} />
        )}
      </ShaderGradientCanvas>
    </div>
  )
}

export default memo(ShaderGradientBackground)

ShaderGradientBackground.displayName = 'ShaderGradientBackground'
