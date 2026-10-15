import { Plus } from 'lucide-react'
import { useRef } from 'react'

import { Button, cn } from '../primitives'

/** The file types every composer's attach picker accepts. */
export const ATTACHMENT_ACCEPT = 'image/*,audio/*,video/*,application/pdf,text/plain'

/**
 * The "+" attach control shared by every composer that accepts attachments (`Composer`): a ghost button that opens the native picker, plus the hidden input
 * it drives. The input is `sr-only` (not `hidden`) so it stays in the tab order, which is why it
 * carries its own `disabled` gate - a keyboard user must not reach the picker through a disabled
 * composer.
 */
export function AttachButton({
  accept = ATTACHMENT_ACCEPT,
  disabled = false,
  className,
  onAttachment,
}: {
  accept?: string
  /** Optional style override for the trigger, e.g. a surface-specific hover fill. */
  className?: string
  disabled?: boolean
  onAttachment: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button
        aria-label="Attach file"
        className={cn('rounded-full', className)}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Plus className="size-4" />
      </Button>
      <input
        accept={accept}
        className="sr-only"
        disabled={disabled}
        multiple
        onChange={(e) => {
          if (e.target.files?.length) {
            onAttachment(Array.from(e.target.files))
          }
          e.target.value = ''
        }}
        ref={inputRef}
        type="file"
      />
    </>
  )
}
