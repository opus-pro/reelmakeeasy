import type { MarkdownEditorHandle } from '@/components/markdown-editor/EditorContainer'
import { whenNonNullable } from '@/lib/jotai-atom-utils'

import { getDisposersAtom, getMarkdownEditorAtom, getMessageAtom } from '../atoms/domain/runtime'
import type { ChatBoxState } from '../chatbox-state'

export function syncChatBoxMessage(state: ChatBoxState, nextMessage: string) {
  state.set(getMessageAtom, nextMessage)

  const applyMessage = (editor: MarkdownEditorHandle) => {
    if (nextMessage) {
      editor.initWithValue(nextMessage)
      return
    }
    editor.clear()
  }

  const editor = state.get(getMarkdownEditorAtom)
  if (editor) {
    applyMessage(editor)
    return
  }

  const dispose = whenNonNullable(state.store, getMarkdownEditorAtom(state), (nextEditor) => {
    // Avoid stale delayed writes when multiple syncs happen before editor ref is registered.
    if (state.get(getMessageAtom) !== nextMessage) {
      return
    }
    applyMessage(nextEditor)
  })
  dispose && state.get(getDisposersAtom).add(dispose)
}
