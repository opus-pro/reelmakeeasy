import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useAtomValue } from 'jotai'
import {
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
} from 'lexical'
import { useEffect, useMemo } from 'react'

import { attachmentsAtom } from '@/atom/inputBox'

import { convertTextToMetaTagNodesFn } from '../custom-nodes/MetaTagNode'
import { convertTextToLexicalNodes } from '../custom-nodes/segment-transformers'

import { onPasteFiles as insertPastedFiles } from './paste-and-copy/onPasteFiles'
import { filterMetaTagsByResourcePool } from './paste-and-copy/onPasteMarkdown'

export function PasteAndCopyPlugin({
  onPasteFiles,
}: {
  onPasteFiles?: (files: File[]) => Promise<void>
}) {
  const [editor] = useLexicalComposerContext()
  const attachments = useAtomValue(attachmentsAtom)
  const validResourceIds = useMemo(() => {
    const ids = new Set<string>()
    for (const attachment of attachments) {
      if (attachment.id) {
        ids.add(attachment.id)
      }
      if (attachment.url) {
        ids.add(attachment.url)
      }
    }
    return ids
  }, [attachments])

  useEffect(() => {
    const releasePasteHandler = editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const clipboard = event.clipboardData
        if (!clipboard) {
          return false
        }

        const files = Array.from(clipboard.files)
        if (files.length > 0) {
          event.preventDefault()
          if (onPasteFiles) {
            void onPasteFiles(files)
          } else {
            insertPastedFiles(editor, files)
          }
          return true
        }

        // Check for text
        const text = clipboard.getData('text/plain').trim()
        if (text) {
          event.preventDefault()

          const filteredText = filterMetaTagsByResourcePool(text, validResourceIds)
          const nodes = convertTextToLexicalNodes(filteredText, [convertTextToMetaTagNodesFn])
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              selection.insertNodes(nodes)
            } else {
              $insertNodes(nodes)
            }
          })
          return true
        }

        return false
      },
      COMMAND_PRIORITY_LOW,
    )

    const handleCopy = (event: ClipboardEvent) => {
      if (!event.clipboardData) {
        return
      }

      editor.getEditorState().read(() => {
        const selection = $getSelection()

        if ($isRangeSelection(selection) && !selection.isCollapsed()) {
          const markdownText = selection.getTextContent()

          if (markdownText && event.clipboardData) {
            event.clipboardData.setData('text/plain', markdownText)
            event.preventDefault()
            return true
          }
        }
      })
    }

    const handleCut = (event: ClipboardEvent) => {
      if (!event.clipboardData) {
        return
      }

      editor.update(() => {
        const selection = $getSelection()

        if ($isRangeSelection(selection) && !selection.isCollapsed()) {
          const markdownText = selection.getTextContent()

          if (markdownText && event.clipboardData) {
            event.clipboardData.setData('text/plain', markdownText)
            // Delete the selected content
            selection.removeText()
            event.preventDefault()
            return true
          }
        }
      })
    }

    const releaseCopyHandler = listen(editor.getRootElement(), 'copy', handleCopy)
    const releaseCutHandler = listen(editor.getRootElement(), 'cut', handleCut)

    return () => {
      releasePasteHandler()
      releaseCopyHandler()
      releaseCutHandler()
    }
  }, [editor, onPasteFiles, validResourceIds])

  return null
}

function listen<EventName extends keyof HTMLElementEventMap>(
  elem: HTMLElement | null,
  eventName: EventName,
  fn: (ev: HTMLElementEventMap[EventName]) => void,
) {
  if (!elem) {
    return () => undefined
  }

  elem.addEventListener(eventName, fn)

  return () => {
    elem.removeEventListener(eventName, fn)
  }
}
