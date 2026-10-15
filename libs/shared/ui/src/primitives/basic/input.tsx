'use client'

import * as React from 'react'

import { cn } from '../../lib/utils'

/** Props of {@link Input}. `className` styles the bordered box; `classNames.input` the field. */
export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'prefix' | 'suffix'> {
  classNames?: {
    /** Added to the box while the field has focus. */
    focusClassName?: string
    /** Added to the `<input>` itself. */
    input?: string
  }
  /** Accepted for compatibility; not used. */
  contentClassName?: string
  defaultValue?: string
  /** Called with the new text on every edit. */
  onChange?: (value: string) => void
  /** Shown inside the box, before the field. */
  prefix?: React.ReactNode
  /** Shown inside the box, after the field. */
  suffix?: React.ReactNode
  value?: string
  /** Inline style of the box (`style` goes to the `<input>`). */
  wrapperStyle?: React.CSSProperties
}

/**
 * Single-line text field in a bordered box, with optional content before and after it.
 *
 * @example
 * <Input onChange={setQuery} placeholder="Search" prefix={<SearchIcon />} value={query} />
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      classNames,
      contentClassName: _contentClassName,
      onBlur,
      onChange,
      onFocus,
      prefix,
      suffix,
      wrapperStyle,
      ...props
    },
    ref,
  ) => {
    const [focused, setFocused] = React.useState(false)

    return (
      <div
        className={cn(
          'box-border flex h-9 w-full rounded-md border border-input bg-popover px-3 py-1',
          focused && ['focus-visible:ring-1 focus-visible:ring-ring', classNames?.focusClassName],
          className,
        )}
        style={wrapperStyle}
      >
        {prefix}
        <input
          className={cn(
            'flex h-auto w-full rounded-md border-0 border-input bg-transparent px-0 py-0 text-base transition-colors [&:placeholder-shown]:text-ellipsis file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm',
            classNames?.input,
          )}
          onBlur={(event) => {
            setFocused(false)
            onBlur?.(event)
          }}
          onChange={(event) => onChange?.(event.target.value)}
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
          ref={ref}
          {...props}
        />
        {suffix}
      </div>
    )
  },
)
Input.displayName = 'Input'

export { Input }
