import * as React from 'react'
import { type IconProps, iconSvgProps } from '../IconBase'

export const File: React.FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...iconSvgProps(props)}>
    <path d="M20 17C20 19.7613 17.7612 21.9998 15 22H9C6.23857 22 4 19.7614 4 17V7C4 4.23858 6.23858 2 9 2H12L12.1074 2.00586C12.3556 2.0327 12.5859 2.15201 12.752 2.3418L19.752 10.3418C19.9114 10.5241 20 10.7578 20 11V17ZM13 9.5C13 9.77614 13.2239 10 13.5 10H16.7959L13 5.66113V9.5ZM6 17C6 18.6569 7.34315 20 9 20H15C16.6567 19.9998 18 18.6567 18 17V12H13.5C12.1193 12 11 10.8807 11 9.5V4H9C7.34315 4 6 5.34315 6 7V17Z" />
  </svg>
)
File.displayName = 'File'
