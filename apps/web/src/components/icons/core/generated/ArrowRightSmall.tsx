import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const ArrowRightSmall: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...iconSvgProps(props)}>
    <path d="M11.293 6.29308C11.6835 5.90255 12.3165 5.90255 12.707 6.29308L17.707 11.2931C18.0973 11.6836 18.0974 12.3167 17.707 12.7071L12.707 17.7071L12.6309 17.7755C12.2381 18.0958 11.6591 18.0731 11.293 17.7071C10.9269 17.3411 10.9043 16.762 11.2246 16.3692L11.293 16.2931L14.5859 13.0001H7C6.44774 13.0001 6.00004 12.5524 6 12.0001C6 11.4478 6.44772 11.0001 7 11.0001H14.5859L11.293 7.70714C10.9025 7.31664 10.9025 6.68361 11.293 6.29308Z" />
  </svg>
)
ArrowRightSmall.displayName = 'ArrowRightSmall'
