import type * as React from 'react'

export type ButtonClickEvent<T = void> = (
  e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
) => Promise<T> | unknown | void

/**
 * Public prop contract for {@link Button}.
 *
 * @example
 * const props: ButtonProps = { variant: 'primary', size: 'lg', autoLoading: true }
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  ['aria-label']?: string
  asChild?: boolean
  autoFocus?: boolean
  /**
   * @description Automatically sets loading state when onClick returns a Promise
   * @default false
   */
  autoLoading?: boolean
  /**
   * @description button content
   */
  children?: React.ReactNode
  /**
   * @description
   */
  className?: string
  color?: string
  /**
   */
  disabled?: boolean
  /**
   * @description Set the loading status of button
   */
  loading?: boolean
  /**
   * @description callback when click button
   */
  onClick?: ButtonClickEvent
  onMouseEnter?: React.MouseEventHandler<HTMLButtonElement>
  onMouseLeave?: React.MouseEventHandler<HTMLButtonElement>
  /**
   * @description
   */
  role?: string
  /**
   * @default default
   */
  size?: 'default' | 'icon' | 'lg' | 'sm' | 'xlg'
  style?: React.CSSProperties
  /**
   * @default button
   */
  type?: 'button' | 'reset' | 'submit'
  /**
   * @description button style
   * @default default
   */
  variant?:
    | 'base'
    | 'default'
    | 'destructive'
    | 'ghost'
    | 'ghost-gray'
    | 'link'
    | 'outline'
    | 'primary'
    | 'secondary'
}
