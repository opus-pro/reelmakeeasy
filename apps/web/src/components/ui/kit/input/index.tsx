import React, { type FocusEventHandler, type HTMLInputTypeAttribute, useState } from 'react'

import { cn } from '../components/lib/cn'
import type { InputProps as BaseInputProps } from '../components/ui/input'
import { Input as BaseInput } from '../components/ui/input'

/** Props for {@link Input}. */
export interface InputProps extends Omit<BaseInputProps, 'onChange' | 'prefix' | 'suffix'> {
  accept?: string
  autoComplete?: string
  className?: string
  classNames?: {
    focusClassName?: string
    input?: string
  }
  contentClassName?: string
  defaultValue?: string
  disabled?: boolean
  onBlur?: FocusEventHandler<HTMLInputElement>
  onChange?: (value: string) => void
  onFocus?: FocusEventHandler<HTMLInputElement>
  /** handle Cmd+Enter */
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  placeholder?: string
  prefix?: null | React.ReactNode
  style?: React.CSSProperties
  suffix?: null | React.ReactNode
  type?: HTMLInputTypeAttribute
  value?: string
  wrapperStyle?: React.CSSProperties
}

const InputInner = (props: InputProps, ref: React.Ref<HTMLInputElement> | undefined) => {
  const {
    className,
    classNames,
    onBlur,
    onChange,
    onFocus,
    prefix,
    suffix,
    wrapperStyle,
    ...rest
  } = props
  const [focus, setFocus] = useState(false)

  return (
    <div
      className={cn(
        'flex px-3 py-1 bg-popover w-full box-border border border-input rounded-md h-9',
        focus && 'focus-visible:ring-1 focus-visible:ring-ring',
        focus && classNames?.focusClassName,
        className,
      )}
      style={wrapperStyle}
    >
      {prefix}
      <BaseInput
        className={cn(
          'px-0 py-0 border-0 focus-visible:ring-0 h-auto [&:placeholder-shown]:text-ellipsis',
          classNames?.input,
        )}
        onBlur={(e) => {
          setFocus(false)
          onBlur?.(e)
        }}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={(e) => {
          setFocus(true)
          onFocus?.(e)
        }}
        ref={ref}
        {...rest}
      />
      {suffix}
    </div>
  )
}

/**
 * Text input wrapped in a bordered container with optional prefix/suffix
 * adornments and a wrapper-level focus ring.
 *
 * @example
 * <Input prefix={<SearchIcon />} placeholder="Search" onChange={setQuery} />
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(InputInner)
Input.displayName = 'Input'
