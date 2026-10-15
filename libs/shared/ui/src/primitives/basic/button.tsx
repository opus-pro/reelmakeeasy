'use client'

import { ReloadIcon } from '@radix-ui/react-icons'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '../../lib/utils'

// `size` is declared before `variant` on purpose: cva emits classes in key order and cn() keeps
// the last of two conflicting classes, so a variant such as `base` (p-0 h-auto) can undo the
// padding and height that the size adds.
const buttonClasses = cva(
  'flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium transition-colors focus-visible:ring-0 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    defaultVariants: { size: 'default', variant: 'default' },
    variants: {
      size: {
        default: 'h-9 p-2',
        icon: 'size-9 p-0',
        lg: 'h-10 px-4',
        sm: 'h-8 px-2 text-xs',
        xlg: 'h-12 px-4',
      },
      variant: {
        base: 'h-auto bg-transparent p-0 text-primary',
        // Brighter on hover, like the app's other filled controls (the chat box's attach and mic).
        default: 'bg-[#ffffff1a] text-primary hover:bg-fill-hover',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        ghost: 'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
        'ghost-gray':
          'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'bg-[#ffffff1a] text-primary underline-offset-4 hover:underline',
        outline:
          'border border-input bg-background text-[#FAFAFA] shadow-sm hover:bg-accent hover:text-accent-foreground',
        primary: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
      },
    },
  },
)

/** Click handler of a Button. With `autoLoading`, a returned promise drives the spinner. */
type ButtonClickHandler = (event: React.MouseEvent<HTMLButtonElement>) => unknown

/** Props of {@link Button}: every native button attribute plus the options below. */
export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'> {
  /** Render the single child element instead of a `<button>`, passing the button's props on. */
  asChild?: boolean
  /** Show the spinner while the promise returned by `onClick` is pending. */
  autoLoading?: boolean
  /** Show the spinner and ignore clicks. The button stays focusable. */
  loading?: boolean
  onClick?: ButtonClickHandler
  /** @default 'default' */
  size?: 'default' | 'icon' | 'lg' | 'sm' | 'xlg'
  type?: 'button' | 'reset' | 'submit'
  /** @default 'default' */
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

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * Text or icon button.
 *
 * @example
 * <Button size="sm" variant="primary" onClick={save}>Save</Button>
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { asChild, autoLoading, children, className, loading, onClick, size, variant, ...props },
    ref,
  ) => {
    const [pending, setPending] = React.useState(false)
    const mounted = React.useRef(true)
    React.useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
      }
    }, [])

    const busy = Boolean(loading) || pending

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      if (busy || !onClick) return
      const result = onClick(event)
      if (!autoLoading || !isPromiseLike(result)) return
      setPending(true)
      const done = () => {
        if (mounted.current) setPending(false)
      }
      // A rejection is left to surface to the caller, so only the spinner is reset here.
      void Promise.resolve(result).finally(done)
    }

    const classes = cn(buttonClasses({ size, variant }), className)

    if (asChild) {
      return (
        <Slot className={classes} onClick={handleClick} ref={ref} {...props}>
          {children}
        </Slot>
      )
    }

    return (
      <button className={classes} onClick={handleClick} ref={ref} {...props}>
        {busy && <ReloadIcon className="mr-2 size-4 animate-spin" />}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

export { Button }
