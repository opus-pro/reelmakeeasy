'use client'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { cn } from '@shared/ui'
import {
  $createParagraphNode,
  $createRangeSelectionFromDom,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import { type DragEvent as ReactDragEvent, useCallback } from 'react'

import { DRAG_PROTOCOLS } from '@/components/dnd/drag-protocol'
import {
  $createMetaTagNode,
  $isMetaTagNode,
} from '@/components/markdown-editor/custom-nodes/MetaTagNode'
import { getResourceTypeFromMime } from '@/components/markdown-editor/custom-nodes/utils'

interface ContentEditablePluginProps {
  // Accessible name for the textbox. aria-placeholder alone is not a name, so a caller
  // whose composer carries visible scope (e.g. an artifact tag) passes it here.
  ariaLabel?: string
  contentEditableClassName?: string
  dataTestId?: string
  placeholder: string
  placeholderClassName?: string
}

export function ContentEditablePlugin({
  ariaLabel,
  contentEditableClassName,
  dataTestId,
  placeholder,
  placeholderClassName,
}: ContentEditablePluginProps) {
  const [editor] = useLexicalComposerContext()

  const moveCaretToDropPoint = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const selection = window.getSelection()
    if ('caretPositionFromPoint' in document) {
      const position = (
        document as Document & {
          caretPositionFromPoint?: (
            x: number,
            y: number,
          ) => null | { offset: number; offsetNode: Node }
        }
      ).caretPositionFromPoint?.(event.clientX, event.clientY)
      if (position && selection) {
        const range = document.createRange()
        range.setStart(position.offsetNode, position.offset)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    } else if ('caretRangeFromPoint' in document) {
      const range = (
        document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => null | Range
        }
      ).caretRangeFromPoint?.(event.clientX, event.clientY)
      if (range && selection) {
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
  }, [])

  const insertDroppedMetaTag = useCallback(
    (payload: {
      duration?: number
      previewUrl?: string
      resourceId: string
      resourceType: ReturnType<typeof getResourceTypeFromMime>
      title: string
    }) => {
      const domSelection = window.getSelection()
      const rangeSelection = $createRangeSelectionFromDom(domSelection, editor)
      const metaTagNode = $createMetaTagNode({
        duration: payload.duration,
        previewUrl: payload.previewUrl,
        resourceId: payload.resourceId,
        resourceType: payload.resourceType,
        title: payload.title,
      })

      if ($isRangeSelection(rangeSelection)) {
        rangeSelection.insertNodes([metaTagNode])
        return true
      }

      const lexicalSelection = $getSelection()
      if ($isRangeSelection(lexicalSelection)) {
        lexicalSelection.insertNodes([metaTagNode])
        return true
      }

      const root = $getRoot()
      let lastParagraph = root.getLastChild()
      if (!lastParagraph) {
        lastParagraph = $createParagraphNode()
        root.append(lastParagraph)
      }
      lastParagraph.selectEnd()
      const fallbackSelection = $getSelection()
      if ($isRangeSelection(fallbackSelection)) {
        fallbackSelection.insertNodes([metaTagNode])
        return true
      }
      return false
    },
    [editor],
  )

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const anchorDragPayload = event.dataTransfer.getData(DRAG_PROTOCOLS.anchorAsset.mime)
      if (anchorDragPayload) {
        const payload = DRAG_PROTOCOLS.anchorAsset.parse(anchorDragPayload)
        if (!payload) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        moveCaretToDropPoint(event)
        editor.focus()
        editor.update(() => {
          insertDroppedMetaTag({
            previewUrl: payload.previewUrl,
            resourceId: payload.resourceId,
            resourceType: getResourceTypeFromMime(payload.mime),
            title: payload.title,
          })
        })
        return
      }

      const metaTagDragPayload = event.dataTransfer.getData(DRAG_PROTOCOLS.metaTagNode.mime)
      if (!metaTagDragPayload) {
        return
      }

      const payload = DRAG_PROTOCOLS.metaTagNode.parse(metaTagDragPayload)
      if (!payload) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      moveCaretToDropPoint(event)
      editor.focus()
      editor.update(() => {
        const inserted = insertDroppedMetaTag({
          duration: payload.duration,
          previewUrl: payload.previewUrl,
          resourceId: payload.resourceId,
          resourceType: payload.resourceType,
          title: payload.title,
        })
        if (!inserted) {
          return
        }

        const sourceNode = $getNodeByKey(payload.sourceNodeKey)
        if ($isMetaTagNode(sourceNode)) {
          sourceNode.remove()
        }
      })
    },
    [editor, insertDroppedMetaTag, moveCaretToDropPoint],
  )

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const dragTypes = new Set(event.dataTransfer.types)
      const hasAnchorAssetPayload = dragTypes.has(DRAG_PROTOCOLS.anchorAsset.mime)
      const hasMetaTagPayload = dragTypes.has(DRAG_PROTOCOLS.metaTagNode.mime)
      if (!hasAnchorAssetPayload && !hasMetaTagPayload) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = hasMetaTagPayload ? 'move' : 'copy'
      moveCaretToDropPoint(event)
    },
    [moveCaretToDropPoint],
  )

  return (
    <RichTextPlugin
      contentEditable={
        <ContentEditable
          aria-label={ariaLabel}
          aria-placeholder={placeholder}
          className={cn(
            'relative min-h-[24px] p-0 text-[16px] leading-[26px] tracking-[-0.12px] text-white outline-none',
            contentEditableClassName,
          )}
          data-enable-meta-tag-drag="true"
          data-testid={dataTestId}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          placeholder={
            <div
              className={cn(
                'pointer-events-none absolute left-0 top-0 text-[16px] leading-[26px] tracking-[-0.12px] text-tertiary',
                placeholderClassName,
              )}
            >
              {placeholder}
            </div>
          }
        />
      }
      ErrorBoundary={LexicalErrorBoundary}
    />
  )
}
