'use client'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND } from 'lexical'
import { useEffect } from 'react'

interface EnterKeyPluginProps {
  enableEnterToSend?: boolean
  onEnterPress?: () => void
}

export function EnterKeyPlugin({ enableEnterToSend = false, onEnterPress }: EnterKeyPluginProps) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!enableEnterToSend || !onEnterPress) {
      return
    }

    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) {
          return false
        }

        // If Shift key is pressed, allow default behavior (new line)
        if (event.shiftKey) {
          return false
        }

        // Otherwise, prevent default and trigger send
        event.preventDefault()
        event.stopPropagation()
        onEnterPress()
        return true // Mark as handled
      },
      COMMAND_PRIORITY_HIGH, // High priority to intercept before other handlers
    )
  }, [editor, enableEnterToSend, onEnterPress])

  return null
}
