'use client'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'

import {
  type MetaTagDeleteHandler,
  registerMetaTagDeleteHandler,
} from '../custom-nodes/meta-tag-delete-registry'

export function MetaTagDeleteHandlerPlugin({ handler }: { handler?: MetaTagDeleteHandler }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!handler) {
      return
    }
    return registerMetaTagDeleteHandler(editor, handler)
  }, [editor, handler])

  return null
}
