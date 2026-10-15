import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import { useEffect } from 'react'

export function AutoFocusPlugin({ enabled = true }: { enabled?: boolean }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!enabled) {
      return
    }

    // Small delay to ensure editor is fully initialized
    const timeoutId = setTimeout(() => {
      editor.update(() => {
        const root = $getRoot()
        root.selectEnd()
      })
      editor.focus()
    }, 0)

    return () => clearTimeout(timeoutId)
  }, [editor, enabled])

  return null
}
