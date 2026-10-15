import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const PlusSmall: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...iconSvgProps(props)}>
    <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)
PlusSmall.displayName = 'PlusSmall'
