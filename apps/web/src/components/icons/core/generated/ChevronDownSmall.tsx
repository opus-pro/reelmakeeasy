import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const ChevronDownSmall: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...iconSvgProps(props)}>
    <path d="M16.293 9.29289C16.6836 8.90237 17.3166 8.90237 17.7071 9.29289C18.0976 9.68343 18.0976 10.3165 17.7071 10.707L12.7071 15.707C12.3166 16.0975 11.6836 16.0974 11.293 15.707L6.29302 10.707C5.90249 10.3164 5.90249 9.68342 6.29302 9.29289C6.68354 8.90237 7.31656 8.90237 7.70708 9.29289L12.0001 13.5859L16.293 9.29289Z" />
  </svg>
)
ChevronDownSmall.displayName = 'ChevronDownSmall'
