import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const ThreeLines: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...iconSvgProps(props)}>
    <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)
ThreeLines.displayName = 'ThreeLines'
