import { Pencil } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../lib/utils'

// Figma "Font/body-md" (16/26/-0.12). Spelled out rather than `text-body-md` because
// `.text-sm` outranks `.text-body-md` on source order, so the token loses to a form control's
// own font size. Arbitrary values always win.
export const FREE_TEXT_PILL_INPUT_CLASS =
  'text-[16px] leading-6.5 tracking-[-0.12px] text-primary placeholder:text-tertiary'
export const FREE_TEXT_PILL_PLACEHOLDER_CLASS =
  'text-[16px] leading-6.5 tracking-[-0.12px] text-tertiary'

/**
 * The frosted "Something else..." free-text pill shell: a rounded-full bordered container with a
 * leading edit icon (override via `leading`) and the caller's input/controls as children.
 * Presentation only -- input behavior, submit, and trailing controls live in the consumer. Extra
 * div props (data-*, onKeyDown, role) are forwarded to the container.
 */
export function FreeTextPill({
  children,
  className,
  leading,
  ...rest
}: ComponentPropsWithoutRef<'div'> & {
  children: ReactNode
  leading?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex min-h-13.5 items-center gap-2.5 rounded-full border-[0.5px] border-subtle bg-fill-secondary py-2 pl-1.5 pr-2 backdrop-blur-2xl',
        className,
      )}
      {...rest}
    >
      {leading ?? (
        <span className="flex size-9.5 shrink-0 items-center justify-center">
          <Pencil aria-hidden className="size-4.5 text-secondary" />
        </span>
      )}
      {children}
    </div>
  )
}
