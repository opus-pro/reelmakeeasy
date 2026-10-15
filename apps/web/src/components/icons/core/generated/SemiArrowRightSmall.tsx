import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const SemiArrowRightSmall: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...iconSvgProps(props)}>
    <path d="M9.29301 6.29295C9.68354 5.90243 10.3166 5.90243 10.7071 6.29295L15.7071 11.293C16.0974 11.6835 16.0975 12.3165 15.7071 12.707L10.7071 17.707L10.6309 17.7754C10.2382 18.0957 9.65913 18.0731 9.29301 17.707C8.9269 17.3409 8.90432 16.7619 9.22465 16.3691L9.29301 16.293L13.4092 12.1767C13.5068 12.0791 13.5067 11.9209 13.4092 11.8232L9.29301 7.70702C8.90249 7.31649 8.90249 6.68348 9.29301 6.29295Z" />
  </svg>
)
SemiArrowRightSmall.displayName = 'SemiArrowRightSmall'
