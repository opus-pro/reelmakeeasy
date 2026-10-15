'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { AutoLinkNode } from '@lexical/link'
import { $convertToMarkdownString } from '@lexical/markdown'
import { type InitialConfigType, LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { EditorRefPlugin } from '@lexical/react/LexicalEditorRefPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { cn } from '@shared/ui'
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  LexicalEditor,
} from 'lexical'
import { forwardRef, useImperativeHandle, useRef } from 'react'

import { MetaTagNode } from '@/components/markdown-editor/custom-nodes/MetaTagNode'
import {
  convertToEditorState,
  TransformersWithoutLongTake,
} from '@/components/markdown-editor/custom-nodes/transformers'
import { DisableFormattingPlugin } from '@/components/markdown-editor/plugins/DisableFormattingPlugin'

import { ReferenceTypeaheadOption, ReferenceTypeaheadPlugin } from './ReferenceTypeaheadPlugin'

const nsLogger = Logger.get('story-mode.reference-prompt-editor')

const nodes = [AutoLinkNode, MetaTagNode]

const theme = {
  link: 'text-accent-green bg-fill-tertiary hover:bg-fill-hover rounded shadow-sm px-[6px] py-[3px] max-w-[200px]',
  paragraph: '',
}

export type ReferencePromptEditorHandle = {
  reset: (value: string) => void
}

export const ReferencePromptEditor = forwardRef<
  ReferencePromptEditorHandle,
  {
    className?: string
    disabled?: boolean
    initValue: string
    onChange?: (value: string) => void
    placeholder?: string
    placeholderClassName?: string
    referenceOption: null | ReferenceTypeaheadOption
  }
>(
  (
    {
      className,
      disabled = false,
      initValue,
      onChange,
      placeholder,
      placeholderClassName,
      referenceOption,
    },
    ref,
  ) => {
    const editorRef = useRef<LexicalEditor | null>(null)
    const placeholderElement = (
      <div className={cn('pointer-events-none absolute left-0 top-0', placeholderClassName)}>
        {placeholder ?? ''}
      </div>
    )
    const initialConfig: InitialConfigType = {
      editable: !disabled,
      editorState: () => convertToEditorState(initValue, TransformersWithoutLongTake),
      namespace: 'story-mode-reference-prompt-editor',
      nodes,
      onError: (error: Error) => {
        nsLogger.error(error)
      },
      theme,
    }

    useImperativeHandle(ref, () => ({
      reset: (value: string) => {
        const editor = editorRef.current
        if (!editor) {
          return
        }

        editor.update(() => {
          const rootNode = $getRoot()
          rootNode.clear()
          convertToEditorState(value, TransformersWithoutLongTake)

          if (rootNode.getChildrenSize() === 0) {
            rootNode.append($createParagraphNode())
          }

          rootNode.selectEnd()
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            selection.format = 0
          }
        })
      },
    }))

    return (
      <div className="relative overflow-hidden">
        <LexicalComposer initialConfig={initialConfig}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                aria-placeholder={placeholder ?? ''}
                className={cn('relative', className)}
                placeholder={placeholderElement}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
            placeholder={placeholderElement}
          />
          <EditorRefPlugin editorRef={editorRef} />
          <HistoryPlugin />
          <DisableFormattingPlugin />
          <ReferenceTypeaheadPlugin option={referenceOption} />
          <OnChangePlugin
            onChange={(editorState) => {
              editorState.read(() => {
                onChange?.($convertToMarkdownString(TransformersWithoutLongTake))
              })
            }}
          />
        </LexicalComposer>
      </div>
    )
  },
)

ReferencePromptEditor.displayName = 'ReferencePromptEditor'
