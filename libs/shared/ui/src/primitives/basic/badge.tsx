import { cva } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '../../lib/utils'

/** The looks a Badge can take. */
export type BadgeVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'success'
  | 'warning'

const badgeClasses = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    defaultVariants: { variant: 'default' },
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80',
        outline: 'text-foreground',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        success: 'border-transparent bg-success/15 text-success shadow hover:bg-success/10',
        warning: 'border-transparent bg-warn/15 text-warn shadow hover:bg-warn/10',
      } satisfies Record<BadgeVariant, string>,
    },
  },
)

/** Props of {@link Badge}: a `<div>`'s attributes plus the variant. */
export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  /** @default 'default' */
  variant?: BadgeVariant | null
}

/**
 * Small label or status pill.
 *
 * @example
 * <Badge variant="success">Active</Badge>
 */
const Badge: React.FC<BadgeProps> = ({ className, variant, ...props }) => (
  <div className={cn(badgeClasses({ variant }), className)} {...props} />
)
Badge.displayName = 'Badge'

export { Badge }
