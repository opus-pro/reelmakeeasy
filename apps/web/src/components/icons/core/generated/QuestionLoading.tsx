import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const QuestionLoading: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...iconSvgProps(props)}>
    <path d="M20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 12.5523 3.55228 13 3 13C2.44772 13 2 12.5523 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C11.4477 22 11 21.5523 11 21C11 20.4477 11.4477 20 12 20C16.4183 20 20 16.4183 20 12Z" />
  </svg>
)
QuestionLoading.displayName = 'QuestionLoading'
