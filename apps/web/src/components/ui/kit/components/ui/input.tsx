/** Locally modified, NOT upstream-pristine shadcn: drops shadow-sm and uses text-base sm:text-sm sizing. Diff against upstream before any `shadcn add --overwrite input`. */
import * as React from 'react'

import { cn } from '../lib/cn'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        className={cn(
          // here we've removed the shadow-sm, the better way to do it is to set --tw-shadow
          'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base sm:text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        type={type}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
