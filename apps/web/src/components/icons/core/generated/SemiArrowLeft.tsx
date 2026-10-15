import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const SemiArrowLeft: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...iconSvgProps(props)}>
    <path d="M16.6945 3.29312C16.2871 2.90261 15.6273 2.90263 15.2199 3.29312L7.61146 10.5861L7.4679 10.7375C6.79958 11.523 6.8477 12.682 7.61146 13.4142L15.2199 20.7072L15.299 20.7755C15.7087 21.0959 16.3125 21.0732 16.6945 20.7072C17.0764 20.3411 17.0999 19.7621 16.7658 19.3693L16.6945 19.2931L9.46302 12.3615C9.25769 12.1647 9.25769 11.8357 9.46302 11.6388L16.6945 4.70719C17.1019 4.31666 17.1019 3.68365 16.6945 3.29312Z" />
  </svg>
)
SemiArrowLeft.displayName = 'SemiArrowLeft'
