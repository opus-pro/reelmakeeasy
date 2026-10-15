import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const CheckMark: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...iconSvgProps(props)}>
    <path d="M18.2936 6.79869C18.6841 6.40073 19.3172 6.40068 19.7077 6.79869C20.0981 7.19671 20.0981 7.84196 19.7077 8.23995L11.061 17.0528C10.5119 17.6124 9.64326 17.6469 9.0541 17.1573L8.93984 17.0528L4.29323 12.3169L4.22487 12.2393C3.90451 11.8389 3.9271 11.2488 4.29323 10.8756C4.65936 10.5025 5.2384 10.4795 5.63116 10.806L5.70733 10.8756L9.82365 15.071C9.9213 15.1704 10.0796 15.1705 10.1772 15.071L18.2936 6.79869Z" />
  </svg>
)
CheckMark.displayName = 'CheckMark'
