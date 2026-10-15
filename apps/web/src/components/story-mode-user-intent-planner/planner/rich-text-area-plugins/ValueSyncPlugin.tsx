'use client'

import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $createParagraphNode, $getRoot } from 'lexical'
import { useEffect, useRef } from 'react'

import { DefaultTransformers } from '@/components/markdown-editor/custom-nodes/transformers'

export function ValueSyncPlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext()
  const lastEditorValueRef = useRef('')

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        lastEditorValueRef.current = $convertToMarkdownString(DefaultTransformers)
      })
    })
  }, [editor])

  useEffect(() => {
    if (value === lastEditorValueRef.current) {
      return
    }
    lastEditorValueRef.current = value
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      if (!value) {
        root.append($createParagraphNode())
        return
      }
      $convertFromMarkdownString(value, DefaultTransformers)
    })
  }, [value, editor])

  return null
}
