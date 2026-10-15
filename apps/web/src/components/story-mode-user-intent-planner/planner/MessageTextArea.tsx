'use client'

import { useAtomValue } from 'jotai'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import { isTouchPrimaryInput } from '@/util/browser-env'

import { getComposerAssetsAtom } from '../state/computed/planner'
import {
  fillTextWithAssetsEvent,
  getPlannerEvents,
  selectAssetEvent,
  selectShotEvent,
  selectTextEvent,
} from '../state/events/planner-events'
import { usePlannerState } from '../state/planner-context'

import {
  insertAsset,
  insertSelectedTextTag,
  insertShotTag,
  setTextAndInsertAssets,
} from './rich-text-area-plugins/operations'
import { RichTextArea, type RichTextAreaHandle } from './RichTextArea'

export interface MessageTextAreaHandle {
  getTextArea: () => null | RichTextAreaHandle
}

interface MessageTextAreaProps {
  ariaLabel?: string
  contentEditableClassName?: string
  dataTestId?: string
  enableAssetInsert?: boolean
  onChange?: (value: string) => void
  onEnterPress?: () => void
  placeholder: string
  placeholderClassName?: string
  value: string
}

export const MessageTextArea = forwardRef<MessageTextAreaHandle, MessageTextAreaProps>(
  function MessageTextArea(
    {
      ariaLabel,
      contentEditableClassName,
      dataTestId,
      enableAssetInsert = true,
      onChange,
      onEnterPress,
      placeholder,
      placeholderClassName,
      value,
    },
    ref,
  ) {
    const state = usePlannerState()
    const shouldUseEnterForNewline = isTouchPrimaryInput()
    const allAssets = useAtomValue(getComposerAssetsAtom(state))
    const richTextAreaRef = useRef<RichTextAreaHandle>(null)

    useEffect(() => {
      if (!enableAssetInsert) {
        return
      }

      const events = getPlannerEvents(state)
      const unsubscribeAsset = events.subscribe(selectAssetEvent, (asset) => {
        const editor = richTextAreaRef.current?.getEditor()
        if (editor) {
          insertAsset(editor, asset)
        }
      })

      const unsubscribeShot = events.subscribe(selectShotEvent, (shot) => {
        const editor = richTextAreaRef.current?.getEditor()
        if (editor) {
          insertShotTag(editor, shot)
        }
      })

      const unsubscribeSelectText = events.subscribe(selectTextEvent, (payload) => {
        const editor = richTextAreaRef.current?.getEditor()
        if (editor) {
          insertSelectedTextTag(editor, payload)
        }
      })

      const unsubscribeFillTextWithAssets = events.subscribe(fillTextWithAssetsEvent, (payload) => {
        const editor = richTextAreaRef.current?.getEditor()
        if (editor) {
          setTextAndInsertAssets(editor, payload.text, payload.assets)
        }
      })

      return () => {
        unsubscribeAsset()
        unsubscribeShot()
        unsubscribeSelectText()
        unsubscribeFillTextWithAssets()
      }
    }, [enableAssetInsert, state])

    useImperativeHandle(ref, () => ({
      getTextArea: () => richTextAreaRef.current,
    }))

    return (
      <RichTextArea
        ariaLabel={ariaLabel}
        assets={allAssets}
        contentEditableClassName={contentEditableClassName}
        dataTestId={dataTestId}
        onChange={onChange}
        onEnterPress={shouldUseEnterForNewline ? undefined : onEnterPress}
        placeholder={placeholder}
        placeholderClassName={placeholderClassName}
        ref={richTextAreaRef}
        value={value}
      />
    )
  },
)
