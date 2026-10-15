import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useAtomValue } from 'jotai'
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical'
import { useEffect, useMemo } from 'react'

import { attachmentsAtom } from '@/atom/inputBox'

import { MetaTagNode } from '../custom-nodes/MetaTagNode'

/**
 * One-way sync: Atom -> Editor
 * When an attachment is removed from atom (e.g., during reset), remove corresponding nodes from editor.
 *
 * Note: We intentionally do NOT sync Editor -> Atom.
 * The attachmentsAtom acts as a "resource pool" that persists until explicit reset.
 * This allows Undo/Redo to work correctly - deleting a node in the editor doesn't
 * destroy the underlying file data, so it can be restored on Undo.
 * Cleanup happens only on explicit reset (resetEditorState) or when submitting
 * (only actively referenced attachments are used).
 */
export function AttachmentsSyncPlugin() {
  const [editor] = useLexicalComposerContext()
  const attachments = useAtomValue(attachmentsAtom)

  const validResourceIds = useMemo(() => {
    const ids = new Set<string>()
    for (const attachment of attachments) {
      // Always use id as the canonical identifier
      // All insertMetaTag calls should use attachment.id as resourceId
      if (attachment.id) {
        ids.add(attachment.id)
      }
    }
    return ids
  }, [attachments])

  // Atom -> Editor: remove nodes when attachments are removed (e.g., during reset)
  useEffect(() => {
    editor.update(() => {
      const root = $getRoot()

      const visit = (node: LexicalNode) => {
        if ($isElementNode(node)) {
          const children = node.getChildren()
          for (const child of children) {
            visit(child)
          }
          return
        }
        if (node instanceof MetaTagNode) {
          const resourceId = node.getResourceId()
          if (!validResourceIds.has(resourceId)) {
            node.remove()
          }
        }
      }

      visit(root)
    })
  }, [editor, validResourceIds])

  return null
}
