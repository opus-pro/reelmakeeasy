import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const ChevronUpSmall: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...iconSvgProps(props)}>
    <path d="M7.70705 14.707C7.31652 15.0975 6.6835 15.0975 6.29298 14.707C5.90253 14.3164 5.90248 13.6834 6.29298 13.2929L11.293 8.29286C11.6835 7.90236 12.3165 7.90241 12.7071 8.29286L17.7071 13.2929C18.0976 13.6834 18.0976 14.3164 17.7071 14.707C17.3166 15.0975 16.6835 15.0975 16.293 14.707L12 10.414L7.70705 14.707Z" />
  </svg>
)
ChevronUpSmall.displayName = 'ChevronUpSmall'
