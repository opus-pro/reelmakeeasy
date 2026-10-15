import { Button, cn, Tooltip } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { memo } from 'react'

import { Redo, Undo } from '@/components/icons/core'
import { useRefAtomCallback } from '@/hooks/use-ref-callback'

import { useHistoryKeyboard } from '../hooks/useHistoryKeyboard'
import { editorHistoryStore } from '../stores/editor-history.store'
import { syncVideoScriptToStore } from '../utils/sync-video-script-to-store'

interface EditorHistoryToolbarProps {
  className?: string
}

export const EditorHistoryToolbar = memo<EditorHistoryToolbarProps>(({ className }) => {
  useHistoryKeyboard()
  const canUndo = useAtomValue(editorHistoryStore.canUndoAtom)
  const canRedo = useAtomValue(editorHistoryStore.canRedoAtom)

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

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Tooltip className="bg-overlay rounded-xs text-primary backdrop-blur-xl" content="Undo">
        <Button
          className={cn(
            'size-8 flex items-center justify-center bg-transparent rounded-sm hover:bg-fill-hover',
            !canUndo && 'cursor-default',
          )}
          onClick={canUndo ? handleUndo : undefined}
          size="icon"
        >
          <Undo className={cn('size-4.5', canUndo ? 'text-primary' : 'text-tertiary')} />
        </Button>
      </Tooltip>

      <Tooltip className="bg-overlay rounded-xs text-primary backdrop-blur-xl" content="Redo">
        <Button
          className={cn(
            'size-8 flex items-center justify-center bg-transparent rounded-sm hover:bg-fill-hover',
            !canRedo && 'cursor-default',
          )}
          onClick={canRedo ? handleRedo : undefined}
          size="icon"
        >
          <Redo className={cn('size-4.5', canRedo ? 'text-primary' : 'text-tertiary')} />
        </Button>
      </Tooltip>
    </div>
  )
})

EditorHistoryToolbar.displayName = 'EditorHistoryToolbar'
