import * as React from 'react'

import { cn } from '../../lib/utils'

/** Props of {@link Textarea}: a `<textarea>`'s attributes, with `onChange` getting the text. */
export interface TextareaProps
  extends Omit<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    'defaultValue' | 'onChange' | 'value'
  > {
  defaultValue?: string
  /** Called with the new text on every edit. */
  onChange?: (value: string) => void
  value?: string
}

/**
 * Multi-line text field.
 *
 * @example
 * <Textarea onChange={setNotes} placeholder="Notes" value={notes} />
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, onChange, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      onChange={(event) => onChange?.(event.target.value)}
      ref={ref}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

export { Textarea }
