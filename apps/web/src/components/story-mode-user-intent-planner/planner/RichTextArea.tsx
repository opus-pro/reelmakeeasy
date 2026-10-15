'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { type InitialConfigType, LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical'
import { forwardRef, type MutableRefObject, useEffect, useImperativeHandle, useRef } from 'react'

import { type MetaTagTooltipRenderer } from '@/components/markdown-editor/custom-nodes/meta-tag-tooltip-registry'
import { MetaTagNode } from '@/components/markdown-editor/custom-nodes/MetaTagNode'
import { DefaultTransformers } from '@/components/markdown-editor/custom-nodes/transformers'
import { DisableFormattingPlugin } from '@/components/markdown-editor/plugins/DisableFormattingPlugin'
import { EnterKeyPlugin } from '@/components/markdown-editor/plugins/EnterKeyPlugin'
import { OnChangePlugin } from '@/components/markdown-editor/plugins/OnChangePlugin'

import type { AssetRef } from '../state-types'

import { AssetTypeaheadPlugin } from './rich-text-area-plugins/AssetTypeaheadPlugin'
import { ContentEditablePlugin } from './rich-text-area-plugins/ContentEditablePlugin'
import { MetaTagTooltipRendererPlugin } from './rich-text-area-plugins/MetaTagTooltipRendererPlugin'
import { MetaTagTypeHandlersPlugin } from './rich-text-area-plugins/MetaTagTypeHandlersPlugin'
import { ValueSyncPlugin } from './rich-text-area-plugins/ValueSyncPlugin'

const nsLogger = Logger.get('story-mode-uip.rich-text-area')

// ---------------------------------------------------------------------------
// EditorCapturePlugin - stores the editor instance in a ref for external use
// ---------------------------------------------------------------------------

function EditorCapturePlugin({ storeRef }: { storeRef: MutableRefObject<LexicalEditor | null> }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    storeRef.current = editor
    return () => {
      storeRef.current = null
    }
  }, [editor, storeRef])
  return null
}

// ---------------------------------------------------------------------------
// RichTextArea - controlled Lexical editor
// ---------------------------------------------------------------------------

const INITIAL_CONFIG: InitialConfigType = {
  namespace: 'uip-rich-text-area',
  nodes: [MetaTagNode],
  onError: (error: Error) => {
    nsLogger.error(error)
  },
  theme: {},
}

export interface RichTextAreaHandle {
  blur: () => void
  focus: () => void
  getEditor: () => LexicalEditor | null
  isCursorAtStart: () => boolean
  isFocused: () => boolean
}

export interface RichTextAreaProps {
  ariaLabel?: string
  assets?: AssetRef[]
  contentEditableClassName?: string
  dataTestId?: string
  metaTagTooltipRenderer?: MetaTagTooltipRenderer
  onChange?: (value: string) => void
  onEnterPress?: () => void
  placeholder?: string
  placeholderClassName?: string
  value: string
}

export const RichTextArea = forwardRef<RichTextAreaHandle, RichTextAreaProps>(function RichTextArea(
  {
    ariaLabel,
    assets,
    contentEditableClassName,
    dataTestId,
    metaTagTooltipRenderer,
    onChange,
    onEnterPress,
    placeholder = '',
    placeholderClassName,
    value,
  },
  ref,
) {
  const editorRef = useRef<LexicalEditor | null>(null)

  useImperativeHandle(ref, () => ({
    blur: () => {
      editorRef.current?.getRootElement()?.blur()
    },
    focus: () => {
      editorRef.current?.focus()
    },
    getEditor: () => editorRef.current,
    isCursorAtStart: () => {
      const editor = editorRef.current
      if (!editor) {
        return false
      }

      let atStart = false
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return
        }

        const root = $getRoot()
        const firstTextNode = root.getFirstDescendant()
        if (!firstTextNode) {
          atStart = true
          return
        }

        atStart = selection.anchor.key === firstTextNode.getKey() && selection.anchor.offset === 0
      })

      return atStart
    },
    isFocused: () => {
      const rootElement = editorRef.current?.getRootElement()
      return rootElement ? document.activeElement === rootElement : false
    },
  }))

  return (
    <LexicalComposer initialConfig={INITIAL_CONFIG}>
      <div className="relative">
        <ContentEditablePlugin
          ariaLabel={ariaLabel}
          contentEditableClassName={contentEditableClassName}
          dataTestId={dataTestId}
          placeholder={placeholder}
          placeholderClassName={placeholderClassName}
        />
      </div>
      <HistoryPlugin />
      <DisableFormattingPlugin />
      <EnterKeyPlugin enableEnterToSend onEnterPress={onEnterPress} />
      <OnChangePlugin onChange={onChange} transformers={DefaultTransformers} />
      <AssetTypeaheadPlugin assets={assets} />
      <ValueSyncPlugin value={value} />
      <MetaTagTypeHandlersPlugin />
      <MetaTagTooltipRendererPlugin renderer={metaTagTooltipRenderer} />
      <EditorCapturePlugin storeRef={editorRef} />
    </LexicalComposer>
  )
})
