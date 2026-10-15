import { Button, cn, Textarea } from '@shared/ui'
import { memo, type RefObject } from 'react'

import { ArrowUp } from '@/components/icons/core'

interface EditBoxPromptFieldProps {
  handleInputFocus: () => void
  handlePrimaryAction: () => void
  handlePromptChange: (value: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  isEditing: boolean
  prompt: string
}

const EditBoxPromptField: React.FC<EditBoxPromptFieldProps> = ({
  handleInputFocus,
  handlePrimaryAction,
  handlePromptChange,
  inputRef,
  isEditing,
  prompt,
}) => {
  return (
    <div className="relative min-w-0 flex-1">
      <Textarea
        className={cn(
          'h-12 min-h-12 w-full resize-none overflow-y-auto rounded-none border-0 bg-transparent py-0 text-base shadow-none transition-[padding,line-height] duration-500 ease-in-out-soft focus-visible:ring-0',
          isEditing ? 'pl-2 pr-3 leading-normal' : 'cursor-text pl-4 pr-12 leading-[3rem]',
          'text-primary placeholder:text-secondary break-words whitespace-pre-wrap',
        )}
        onChange={handlePromptChange}
        onFocus={handleInputFocus}
        placeholder={
          isEditing ? 'What would you like to change...' : 'What would you like to edit...'
        }
        ref={inputRef}
        rows={1}
        value={isEditing ? prompt : ''}
      />
      <Button
        aria-hidden={isEditing}
        className={cn(
          'absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-secondary transition-opacity duration-500 ease-in-out-soft',
          isEditing ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
        onClick={handlePrimaryAction}
        size="icon"
        tabIndex={isEditing ? -1 : undefined}
        type="button"
      >
        <ArrowUp className="size-3.5" />
      </Button>
    </div>
  )
}

export default memo(EditBoxPromptField)
