import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const Loading: React.FC<IconProps> = (props) => (
  <svg fill="currentColor" viewBox="0 0 18 18" width="18" height="18" {...iconSvgProps(props)}>
    <circle cx="9" cy="3" r="1.5" />
    <circle cx="9" cy="15" opacity="0.6" r="1.5" />
    <circle
      cx="4.75706"
      cy="4.75684"
      opacity="0.9"
      r="1.5"
      transform="rotate(-45 4.75706 4.75684)"
    />
    <circle
      cx="13.2424"
      cy="13.2422"
      opacity="0.5"
      r="1.5"
      transform="rotate(-45 13.2424 13.2422)"
    />
    <circle cx="3" cy="9" opacity="0.8" r="1.5" transform="rotate(-90 3 9)" />
    <circle cx="15" cy="9" opacity="0.4" r="1.5" transform="rotate(-90 15 9)" />
    <circle
      cx="4.75781"
      cy="13.242"
      opacity="0.7"
      r="1.5"
      transform="rotate(-135 4.75781 13.242)"
    />
    <circle
      cx="13.2422"
      cy="4.75661"
      opacity="0.3"
      r="1.5"
      transform="rotate(-135 13.2422 4.75661)"
    />
  </svg>
)
Loading.displayName = 'Loading'
