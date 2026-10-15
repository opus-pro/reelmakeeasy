import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const SemiArrowRight: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...iconSvgProps(props)}>
    <path d="M7.30579 3.29314C7.71317 2.90262 8.373 2.90264 8.7804 3.29314L16.3888 10.5861L16.5324 10.7375C17.2007 11.523 17.1526 12.682 16.3888 13.4142L8.7804 20.7072L8.7013 20.7756C8.29159 21.0959 7.68773 21.0732 7.30579 20.7072C6.92386 20.3411 6.90031 19.7621 7.2345 19.3693L7.30579 19.2931L14.5372 12.3615C14.7426 12.1647 14.7426 11.8357 14.5372 11.6388L7.30579 4.7072C6.8984 4.31667 6.8984 3.68367 7.30579 3.29314Z" />
  </svg>
)
SemiArrowRight.displayName = 'SemiArrowRight'
