import { $convertToMarkdownString, type Transformer } from '@lexical/markdown'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical'
import { useEffect, useRef } from 'react'

import { $isLongTakeNode } from '../custom-nodes/LongTakeNode'
import { DefaultTransformers } from '../custom-nodes/transformers'

interface OnChangePluginProps {
  onChange?: (value: string) => void
  onLongTakeChange?: (hasLongTake: boolean) => void
  transformers?: Transformer[]
}

export function OnChangePlugin({
  onChange,
  onLongTakeChange,
  transformers = DefaultTransformers,
}: OnChangePluginProps) {
  const [editor] = useLexicalComposerContext()
  const previousHasLongTake = useRef<boolean>(false)

  const checkForLongTakeNode = (root: LexicalNode): boolean => {
    const visit = (node: LexicalNode): boolean => {
      if ($isElementNode(node)) {
        const children = node.getChildren()
        for (const child of children) {
          if (visit(child)) {
            return true
          }
        }
        return false
      }
      return $isLongTakeNode(node)
    }

    return visit(root)
  }

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot()

        // Handle text content change - use markdown serialization to preserve formatting
        if (onChange) {
          const markdownContent = $convertToMarkdownString(transformers)
          onChange(markdownContent)
        }

        if (onLongTakeChange) {
          const hasLongTake = checkForLongTakeNode(root)
          if (hasLongTake !== previousHasLongTake.current) {
            previousHasLongTake.current = hasLongTake
            onLongTakeChange(hasLongTake)
          }
        }
      })
    })
  }, [editor, onChange, onLongTakeChange, transformers])

  return null
}
