import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const SidebarMax: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...iconSvgProps(props)}>
    <path d="M18 4C20.2091 4 22 5.79086 22 8V16L21.9951 16.2061C21.8913 18.2512 20.2512 19.8913 18.2061 19.9951L18 20H6L5.79395 19.9951C3.68056 19.8879 2 18.14 2 16V8C2 5.79086 3.79086 4 6 4H18ZM6 6C4.89543 6 4 6.89543 4 8V16C4 17.1046 4.89543 18 6 18H18C19.1046 18 20 17.1046 20 16V8C20 6.89543 19.1046 6 18 6H6ZM9 8C9.55228 8 10 8.44772 10 9V15C10 15.5523 9.55228 16 9 16C8.44772 16 8 15.5523 8 15V9C8 8.44772 8.44772 8 9 8Z" />
  </svg>
)
SidebarMax.displayName = 'SidebarMax'
