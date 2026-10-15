import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { ActiveAttachment, activeAttachmentsAtom } from '@/atom/inputBox'

import { MetaTagNode } from '../custom-nodes/MetaTagNode'
import { $visitMetaTagNodes } from '../custom-nodes/utils'

export function ActiveAttachmentsPlugin() {
  const [editor] = useLexicalComposerContext()
  const setActiveAttachments = useSetAtom(activeAttachmentsAtom)

  useEffect(() => {
    const updateActiveAttachments = () => {
      editor.getEditorState().read(() => {
        const activeAttachments: ActiveAttachment[] = []
        $visitMetaTagNodes((node) => {
          activeAttachments.push({
            id: node.getResourceId(),
            title: node.getTitle(),
            type: node.getResourceType(),
          })
        })
        setActiveAttachments(activeAttachments)
      })
    }

    // 1. Initial check
    updateActiveAttachments()

    // 2. Only re-run when MetaTagNodes are added/removed/modified
    return editor.registerMutationListener(MetaTagNode, () => {
      updateActiveAttachments()
    })
  }, [editor, setActiveAttachments])

  return null
}
