import { useEffect } from 'react'

import { useRefAtomCallback } from '@/hooks/use-ref-callback'

import { editorHistoryStore } from '../stores/editor-history.store'
import { syncVideoScriptToStore } from '../utils/sync-video-script-to-store'

export function useHistoryKeyboard({ disabled = false }: { disabled?: boolean } = {}) {
  const handleUndo = useRefAtomCallback((_get, set) => {
    const undoAtom = editorHistoryStore.undoAtom
    const prevVideoScript = set(undoAtom)

    if (prevVideoScript) {
      syncVideoScriptToStore(set, prevVideoScript)
    }
  })

  const handleRedo = useRefAtomCallback((_get, set) => {
    const redoAtom = editorHistoryStore.redoAtom
    const nextVideoScript = set(redoAtom)

    if (nextVideoScript) {
      syncVideoScriptToStore(set, nextVideoScript)
    }
  })

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
        handleUndo()
      }

      if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
        event.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [disabled, handleUndo, handleRedo])
}
