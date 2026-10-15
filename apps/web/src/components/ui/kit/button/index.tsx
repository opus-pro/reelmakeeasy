import { ReloadIcon } from '@radix-ui/react-icons'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { useState } from 'react'

import { cn } from '../components/lib/cn'

import type { ButtonProps } from './interface'

export type { ButtonProps }

/** cva variant map backing {@link Button}. @example buttonVariants({ variant: 'primary', size: 'lg' }) */
const buttonVariants = cva(
  'flex items-center rounded-sm px-2 gap-2 bg-[#ffffff1a] text-primary cursor-pointer justify-center whitespace-nowrap text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-0 focus-visible:ring-ring',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-9 p-2',
        icon: 'size-9 p-0',
        lg: 'h-10 rounded-sm px-4',
        sm: 'h-8 rounded-sm px-2 text-xs',
        xlg: 'h-12 rounded-sm px-4',
      },
      variant: {
        base: 'bg-transparent p-0 h-auto',
        default: 'bg-[#ffffff1a] text-primary',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground bg-transparent text-foreground',
        'ghost-gray':
          'hover:bg-accent hover:text-accent-foreground bg-transparent text-muted-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground text-[#FAFAFA]',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        primary: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
      },
    },
  },
)

export { buttonVariants }

interface BaseButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  children?: React.ReactNode
  loading?: boolean
}

const BaseButton = React.forwardRef<HTMLButtonElement, BaseButtonProps>(
  ({ asChild = false, children, className, loading, onClick, size, variant, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ className, size, variant }))}
        onClick={(ev: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
          if (loading) {
            return
          }
          onClick?.(ev)
        }}
        ref={ref}
        {...props}
      >
        {loading ? (
          <>
            <ReloadIcon className="mr-2 size-4 animate-spin" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  },
)
BaseButton.displayName = 'BaseButton'

/**
 * Themed action button with variant/size presets and optional promise-driven loading state.
 *
 * @example
 * <Button variant="primary" onClick={async () => save()} autoLoading>Save</Button>
 */
const ButtonImpl = (props: ButtonProps, ref: React.Ref<HTMLButtonElement>): React.ReactElement => {
  const { autoLoading = false, children, onClick, ...rest } = props
  const [loading, setLoading] = useState(false)
  return (
    <BaseButton
      onClick={(e) => {
        const ret = onClick?.(e)
        if (ret && ret instanceof Promise) {
          setLoading(true)
          return ret.finally(() => {
            setLoading(false)
          })
        }
        return ret
      }}
      ref={ref}
      {...rest}
      loading={rest.loading ?? (autoLoading && loading)}
    >
      {children}
    </BaseButton>
  )
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(ButtonImpl)
Button.displayName = 'Button'
