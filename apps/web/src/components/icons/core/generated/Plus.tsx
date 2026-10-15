import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const Plus: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...iconSvgProps(props)}>
    <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)
Plus.displayName = 'Plus'
