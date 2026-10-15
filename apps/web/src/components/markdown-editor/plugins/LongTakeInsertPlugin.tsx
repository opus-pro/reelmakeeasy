import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useAtomValue } from 'jotai'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { useEffect, useRef } from 'react'

import { insertLongTakeAtom } from '@/atom/home'

import { $createLongTakeNode } from '../custom-nodes/LongTakeNode'

/**
 * Plugin that listens to insertLongTakeAtom and inserts LongTakeNode
 * when the atom value changes.
 */
export function LongTakeInsertPlugin() {
  const [editor] = useLexicalComposerContext()
  const triggerCount = useAtomValue(insertLongTakeAtom)
  const prevTriggerCountRef = useRef<number>(0)
  useEffect(() => {
    if (triggerCount > prevTriggerCountRef.current) {
      prevTriggerCountRef.current = triggerCount

      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        root.append(paragraph)

        const longTakeNode = $createLongTakeNode()
        paragraph.append(longTakeNode, $createTextNode('\u00A0'))

        paragraph.selectEnd()
      })
    }
  }, [triggerCount, editor])

  return null
}
