import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { longtakeHistoryStore } from '@/atom/longtake-history.store'

export function useLongTakeHistoryKeyboard({ disabled = false }: { disabled?: boolean } = {}) {
  const undo = useSetAtom(longtakeHistoryStore.undoAtom)
  const redo = useSetAtom(longtakeHistoryStore.redoAtom)

  useEffect(() => {
    if (disabled) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
      const modifierKey = isMac ? event.metaKey : event.ctrlKey
      if (!modifierKey) {
        return
      }

      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      }
      if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
        event.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled, undo, redo])
}
