import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { COMMAND_PRIORITY_LOW, KEY_DOWN_COMMAND } from 'lexical'
import { useEffect } from 'react'

// Custom plugin to disable formatting shortcuts
export function DisableFormattingPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    // Disable common formatting shortcuts
    const removeFormatCommands = [
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: KeyboardEvent) => {
          const { code, ctrlKey, metaKey } = event
          // Check for Ctrl+B, Ctrl+I, Ctrl+U on Windows/Linux or Cmd+B, Cmd+I, Cmd+U on Mac
          if ((ctrlKey || metaKey) && (code === 'KeyB' || code === 'KeyI' || code === 'KeyU')) {
            event.preventDefault()
            return true // Prevent the default formatting behavior
          }
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
    ]

    return () => {
      removeFormatCommands.forEach((remove) => remove())
    }
  }, [editor])

  return null
}
