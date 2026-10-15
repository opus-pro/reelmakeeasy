'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { AutoLinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import { type InitialConfigType, LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { EditorRefPlugin } from '@lexical/react/LexicalEditorRefPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { cn } from '@shared/ui'
import {
  $createParagraphNode,
  $createRangeSelectionFromDom,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $nodesOfType,
  $setSelection,
  LexicalEditor,
} from 'lexical'
import {
  type DragEvent as ReactDragEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'

import { DRAG_PROTOCOLS } from '@/components/dnd/drag-protocol'
import { useRefCallback } from '@/hooks/use-ref-callback'

import { LongTakeNode } from './custom-nodes/LongTakeNode'
import type { MetaTagDeleteHandler } from './custom-nodes/meta-tag-delete-registry'
import { $createMetaTagNode, $isMetaTagNode, MetaTagNode } from './custom-nodes/MetaTagNode'
import {
  convertToEditorState,
  DefaultTransformers,
  TransformersWithoutLongTake,
} from './custom-nodes/transformers'
import { getResourceTypeFromMime } from './custom-nodes/utils'
import { ActiveAttachmentsPlugin } from './plugins/ActiveAttachmentsPlugin'
import { AttachmentsSyncPlugin } from './plugins/AttachmentsSyncPlugin'
import { AutoFocusPlugin } from './plugins/AutoFocusPlugin'
import { DisableFormattingPlugin } from './plugins/DisableFormattingPlugin'
import { EnterKeyPlugin } from './plugins/EnterKeyPlugin'
import { LongTakeInsertPlugin } from './plugins/LongTakeInsertPlugin'
import { MetaTagDeleteHandlerPlugin } from './plugins/MetaTagDeleteHandlerPlugin'
import {
  type MentionMenuVariant,
  type MetaTypeaheadCandidate,
  MetaTypeaheadPlugin,
} from './plugins/MetaTypeaheadPlugin'
import { OnChangePlugin } from './plugins/OnChangePlugin'
import { OverflowHighlightPlugin } from './plugins/OverflowHighlightPlugin'
import { PasteAndCopyPlugin } from './plugins/PasteAndCopyPlugin'

const nsLogger = Logger.get('markdown-editor.editor-container')
const theme = {
  link: 'text-accent-green bg-fill-tertiary hover:bg-fill-hover rounded shadow-sm px-[6px] py-[3px] max-w-[200px]',
  paragraph: '',
  list: {
    ul: 'list-disc ml-6',
    ol: 'list-decimal ml-6',
    listitem: 'ml-1',
    nested: {
      listitem: 'ml-4',
    },
  },
}

export type EditableProps = {
  /** The text box's name for screen readers (the placeholder isn't one). */
  ariaLabel?: string
  autoFocus?: boolean
  className?: string
  containerClassName?: string
  disabled?: boolean
  divRef?: React.RefObject<HTMLDivElement | null>
  enableCustomTools?: {
    longTake?: boolean
  }
  enableEnterToSend?: boolean
  enableMetaTagDrag?: boolean
  enableOverflowHighlight?: boolean
  initValue?: string
  /**
   * Optional @-mention candidates. When provided, the typeahead is driven by
   * this list instead of the `embeddedMetaTagsAtom` (e.g. to offer the
   * session's uploads). Omit to keep the default atom-driven behavior.
   */
  mentionCandidates?: MetaTypeaheadCandidate[]
  mentionMenuVariant?: MentionMenuVariant
  onBlur?: (e: React.FocusEvent<HTMLDivElement>) => void
  onChange?: (value: string) => void
  onEnterPress?: () => void
  onFocus?: (e: React.FocusEvent<HTMLDivElement>) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onLongTakeChange?: (hasLongTake: boolean) => void
  /** Fired at intent time when a meta-tag chip is deleted from the editor. */
  onMetaTagDelete?: MetaTagDeleteHandler
  onPasteFiles?: (files: File[]) => Promise<void>
  /** When provided, renders an "Upload new asset" row in the @-mention typeahead menu. */
  onUploadNewAsset?: () => void
  placeholder?: string
  placeholderClassName?: string
  value?: string
}
export type MarkdownEditorHandle = {
  clear: () => void
  deleteLastChar: () => void
  dismissMentionMenu: () => void
  focus: () => void
  initWithValue: (
    value: string,
    options?: { isUserInitiated?: boolean; scrollToTop?: boolean },
  ) => void
  insertMetaTag: (
    resourceId: string,
    title: string,
    mime: string,
    previewUrl?: string,
    duration?: number,
    options?: { isUserInitiated?: boolean },
  ) => void
  insertText: (text: string) => void
  /**
   * Remove every meta tag whose resource id matches one of the given ids
   * (the attachment id or url). Used when an attachment is deleted outside the
   * editor (e.g. the mobile Song card) so no orphaned pill is left behind to
   * fail send-time validation. No-op when nothing matches.
   */
  removeMetaTag: (resourceIds: string[]) => void
}

const nodes = [AutoLinkNode, MetaTagNode, LongTakeNode, ListNode, ListItemNode]

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, EditableProps>(
  (
    {
      ariaLabel,
      autoFocus,
      containerClassName,
      className,
      disabled,
      enableCustomTools,
      enableEnterToSend,
      enableMetaTagDrag = true,
      enableOverflowHighlight,
      initValue,
      mentionCandidates,
      mentionMenuVariant,
      onBlur,
      onChange,
      onEnterPress,
      onFocus,
      onKeyDown,
      onLongTakeChange,
      onMetaTagDelete,
      onPasteFiles,
      onUploadNewAsset,
      placeholder,
      placeholderClassName,
      divRef,
    },
    ref,
  ) => {
    const innerEditorRef = useRef<LexicalEditor | null>(null)
    const allowLongTake = enableCustomTools?.longTake !== false
    const transformers = allowLongTake ? DefaultTransformers : TransformersWithoutLongTake
    const initialConfig: InitialConfigType = {
      editorState: () => convertToEditorState(initValue ?? '', transformers),
      namespace: 'markdown-editor',
      nodes,
      onError: (error: Error) => {
        nsLogger.error(error)
      },
      theme,
      editable: !disabled,
    }

    const initWithValue = useRefCallback(
      (value: string, options?: { isUserInitiated?: boolean; scrollToTop?: boolean }) => {
        const editor = innerEditorRef.current
        if (!editor) {
          return
        }
        if (!value) {
          editor.update(() => {
            const root = $getRoot()
            root.clear()
            root.append($createParagraphNode())
          })
          return
        }
        editor.update(
          () => {
            // convert markdown to nodes
            convertToEditorState(value, transformers)
            // ensure at least one paragraph and move caret to end
            const rootNode = $getRoot()
            if (rootNode.getChildrenSize() === 0) {
              rootNode.append($createParagraphNode())
            }
            // Selecting moves the Lexical caret, which focuses the editor and triggers
            // compose mode. Only do this for user-initiated writes; programmatic writes
            // (e.g. Remix/Copy Style populating the prompt) should not steal focus.
            if (options?.isUserInitiated) {
              if (options?.scrollToTop) {
                rootNode.selectStart()
              } else {
                rootNode.selectEnd()
              }
            }
          },
          options?.scrollToTop
            ? {
                onUpdate: () => {
                  const rootElement = editor.getRootElement()
                  if (rootElement) {
                    rootElement.scrollTop = 0
                  }
                },
              }
            : undefined,
        )
      },
    )

    const clearEditor = useRefCallback(() => {
      innerEditorRef.current?.update(() => {
        const root = $getRoot()
        const selection = $getSelection()
        const paragraph = $createParagraphNode()
        root.clear()
        root.append(paragraph)

        if (selection !== null) {
          paragraph.select()
        }
        if ($isRangeSelection(selection)) {
          selection.format = 0
        }
      })
    })

    const handleInsertMetaTag = useRefCallback(
      (
        resourceId: string,
        title: string,
        mime: string,
        previewUrl?: string,
        duration?: number,
        options?: { isUserInitiated?: boolean },
      ) => {
        innerEditorRef.current?.update(() => {
          const metaTagNode = $createMetaTagNode({
            resourceId,
            resourceType: getResourceTypeFromMime(mime),
            title,
            previewUrl,
            duration,
          })

          // Programmatic insert (e.g. an upload the user didn't type, like the
          // mobile Song card): append to the end without moving the caret, so the
          // editor doesn't focus or enter compose mode. Mirrors initWithValue's
          // isUserInitiated guard.
          if (options?.isUserInitiated === false) {
            const root = $getRoot()
            const lastChild = root.getLastChild()
            if ($isElementNode(lastChild)) {
              lastChild.append(metaTagNode)
            } else {
              const paragraph = $createParagraphNode()
              paragraph.append(metaTagNode)
              root.append(paragraph)
            }
            return
          }

          const selection = $getSelection()

          if ($isRangeSelection(selection)) {
            selection.insertNodes([metaTagNode])
          } else {
            const root = $getRoot()
            let lastParagraph = root.getLastChild()

            if (!lastParagraph) {
              lastParagraph = $createParagraphNode()
              root.append(lastParagraph)
            }

            lastParagraph.selectEnd()
            const newSelection = $getSelection()
            if ($isRangeSelection(newSelection)) {
              newSelection.insertNodes([metaTagNode])
            }
          }
        })
      },
    )

    const handleRemoveMetaTag = useRefCallback((resourceIds: string[]) => {
      const targets = new Set(resourceIds.filter(Boolean))
      if (targets.size === 0) {
        return
      }
      innerEditorRef.current?.update(() => {
        for (const node of $nodesOfType(MetaTagNode)) {
          if (targets.has(node.getResourceId())) {
            node.remove()
          }
        }
      })
    })

    const moveCaretToDropPoint = useRefCallback((event: ReactDragEvent<HTMLDivElement>) => {
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
    })

    const insertDroppedMetaTag = useRefCallback(
      (
        editor: LexicalEditor,
        payload: {
          duration?: number
          previewUrl?: string
          resourceId: string
          resourceType: ReturnType<typeof getResourceTypeFromMime>
          title: string
        },
      ) => {
        const domSelection = window.getSelection()
        const rangeSelection = $createRangeSelectionFromDom(domSelection, editor)
        const metaTagNode = $createMetaTagNode({
          resourceId: payload.resourceId,
          resourceType: payload.resourceType,
          title: payload.title,
          previewUrl: payload.previewUrl,
          duration: payload.duration,
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
    )

    const handleDrop = useRefCallback((event: ReactDragEvent<HTMLDivElement>) => {
      const anchorDragPayload = event.dataTransfer.getData(DRAG_PROTOCOLS.anchorAsset.mime)
      if (anchorDragPayload) {
        const payload = DRAG_PROTOCOLS.anchorAsset.parse(anchorDragPayload)
        if (!payload) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        moveCaretToDropPoint(event)

        const editor = innerEditorRef.current
        if (!editor) {
          return
        }
        editor.focus()
        editor.update(() => {
          insertDroppedMetaTag(editor, {
            resourceId: payload.resourceId,
            resourceType: getResourceTypeFromMime(payload.mime),
            title: payload.title,
            previewUrl: payload.previewUrl,
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

      const editor = innerEditorRef.current
      if (!editor) {
        return
      }
      editor.focus()
      editor.update(() => {
        const inserted = insertDroppedMetaTag(editor, {
          resourceId: payload.resourceId,
          resourceType: payload.resourceType,
          title: payload.title,
          previewUrl: payload.previewUrl,
          duration: payload.duration,
        })
        if (!inserted) {
          return
        }

        const sourceNode = $getNodeByKey(payload.sourceNodeKey)
        if ($isMetaTagNode(sourceNode)) {
          sourceNode.remove()
        }
      })
    })

    const handleDragOver = useRefCallback((event: ReactDragEvent<HTMLDivElement>) => {
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
    })

    // Keep editor editable state in sync when `disabled` changes.
    useEffect(() => {
      const editor = innerEditorRef.current
      if (editor) {
        editor.setEditable(!disabled)
      }
    }, [disabled])

    const deleteLastChar = useRefCallback(() => {
      innerEditorRef.current?.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          selection.deleteCharacter(true)
        }
      })
    })

    const handleInsertText = useRefCallback((text: string) => {
      innerEditorRef.current?.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          selection.insertText(text)
        }
      })
    })

    const dismissMentionMenu = useRefCallback(() => {
      // Don't mutate the user's text: the typeahead closes itself once there's
      // no active range selection, so clearing selection is enough.
      innerEditorRef.current?.update(() => {
        $setSelection(null)
      })
    })

    useImperativeHandle(ref, () => {
      return {
        clear: clearEditor,
        deleteLastChar,
        dismissMentionMenu,
        focus: () => innerEditorRef.current?.getRootElement()?.focus(),
        initWithValue,
        insertText: handleInsertText,
        insertMetaTag: handleInsertMetaTag,
        removeMetaTag: handleRemoveMetaTag,
      }
    })

    return (
      <div className={cn('overflow-hidden relative', containerClassName)}>
        <LexicalComposer initialConfig={initialConfig}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                aria-placeholder={placeholder ?? ''}
                ariaLabel={ariaLabel}
                className={`relative ${className}`}
                data-enable-meta-tag-drag={String(enableMetaTagDrag)}
                onBlur={onBlur}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onFocus={onFocus}
                onKeyDown={onKeyDown}
                placeholder={
                  <div
                    className={`pointer-events-none absolute left-0 top-0 ${placeholderClassName}`}
                  >
                    {placeholder ?? ''}
                  </div>
                }
                ref={divRef}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <EditorRefPlugin editorRef={innerEditorRef} />
          <HistoryPlugin />
          <ListPlugin />
          <DisableFormattingPlugin />
          <PasteAndCopyPlugin onPasteFiles={onPasteFiles} />
          <MetaTypeaheadPlugin
            candidates={mentionCandidates}
            mentionMenuVariant={mentionMenuVariant}
            onUploadNewAsset={onUploadNewAsset}
          />
          {allowLongTake && <LongTakeInsertPlugin />}
          <OnChangePlugin
            onChange={(str: string) => {
              onChange?.(str)
            }}
            onLongTakeChange={onLongTakeChange}
            transformers={transformers}
          />
          <AttachmentsSyncPlugin />
          <ActiveAttachmentsPlugin />
          <MetaTagDeleteHandlerPlugin handler={onMetaTagDelete} />
          <AutoFocusPlugin enabled={autoFocus} />
          <EnterKeyPlugin enableEnterToSend={enableEnterToSend} onEnterPress={onEnterPress} />
          {enableOverflowHighlight && <OverflowHighlightPlugin enabled={enableOverflowHighlight} />}
        </LexicalComposer>
      </div>
    )
  },
)
