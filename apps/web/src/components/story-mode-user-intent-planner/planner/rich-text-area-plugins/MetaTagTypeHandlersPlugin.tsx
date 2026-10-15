'use client'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useEffect } from 'react'

import { ClipsVertical, Quotes } from '@/components/icons/core'
import {
  type MetaTagTypeHandler,
  registerMetaTagTypeHandler,
} from '@/components/markdown-editor/custom-nodes/meta-tag-type-registry'
import { truncateText } from '@/components/markdown-editor/custom-nodes/utils'

const SELECTED_TEXT_MAX_CHAR_LENGTH = 10

function formatShotLabelFromResourceId(resourceId: string): string {
  const match = resourceId.match(/^shot[_-]?(\d+)$/i)
  if (match?.[1]) {
    return `Shot${match[1]}`
  }
  return 'Shot'
}

const shotHandler: MetaTagTypeHandler = {
  renderIcon: () => (
    <ClipsVertical className="size-[18px] shrink-0 pointer-events-none text-primary" />
  ),
  resolveLabel: ({ fallbackLabel, resourceId }) => {
    const label = formatShotLabelFromResourceId(resourceId)
    return label || fallbackLabel
  },
}

const txtHandler: MetaTagTypeHandler = {
  renderIcon: () => <Quotes className="size-[18px] shrink-0 pointer-events-none text-primary" />,
  resolveLabel: ({ fallbackLabel, resourceId }) => {
    if (resourceId.startsWith('selected-text-')) {
      return truncateText(fallbackLabel, SELECTED_TEXT_MAX_CHAR_LENGTH)
    }
    return fallbackLabel
  },
}

export function MetaTagTypeHandlersPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const unregisterShot = registerMetaTagTypeHandler(editor, 'shot', shotHandler)
    const unregisterTxt = registerMetaTagTypeHandler(editor, 'txt', txtHandler)

    return () => {
      unregisterShot()
      unregisterTxt()
    }
  }, [editor])

  return null
}
