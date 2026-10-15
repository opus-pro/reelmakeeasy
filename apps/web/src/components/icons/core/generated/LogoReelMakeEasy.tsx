import * as React from 'react'
import type { IconProps } from '../IconBase'

/**
 * ReelMakeEasy mark: two glossy play triangles meeting in the middle (`assets/logo.png`,
 * served from `public/static/logo.png`). The favicon and app icons use the round version,
 * `assets/logo-circle.png`. Takes the icon props' size, width, height, className and style.
 */
export const LogoReelMakeEasy: React.FC<IconProps> = ({
  className,
  height,
  size,
  style,
  width,
}) => (
  // eslint-disable-next-line @next/next/no-img-element -- a fixed 256 px asset, nothing to optimize
  <img
    alt="ReelMakeEasy logo"
    className={className}
    draggable={false}
    height={height ?? size ?? 24}
    src="/static/logo.png"
    style={{ objectFit: 'contain', ...(style as React.CSSProperties) }}
    width={width ?? size ?? 24}
  />
)
LogoReelMakeEasy.displayName = 'LogoReelMakeEasy'
