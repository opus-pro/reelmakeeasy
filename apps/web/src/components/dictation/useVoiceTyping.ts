'use client'

import { type RefObject, useCallback, useRef } from 'react'

import { insertSpoken } from './dictation-text'
import { useDictation } from './useDictation'

/**
 * Voice typing into one text box: what was said goes in at the cursor (live, while talking, on
 * the browser engine), and the box keeps focus with the cursor after it.
 */
export function useVoiceTyping({
  inputRef,
  setValue,
  value,
}: {
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  setValue: (value: string) => void
  value: string
}) {
  // The box as it was when talking started; every partial or final result replaces what the
  // previous one put in.
  const base = useRef<null | { cursor: number; value: string }>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const capture = () => {
    if (base.current) return base.current
    const el = inputRef.current
    const current = valueRef.current
    base.current = { cursor: el?.selectionStart ?? current.length, value: current }
    return base.current
  }

  const put = useCallback(
    (text: string, final: boolean) => {
      const start = capture()
      const next = insertSpoken(start.value, text, start.cursor)
      setValue(next.value)
      if (!final) return
      base.current = null
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(next.cursor, next.cursor)
      })
    },

    [inputRef, setValue],
  )

  const dictation = useDictation({
    onPartial: (text) => put(text, false),
    onText: (text) => put(text, true),
  })

  const start = dictation.start
  return {
    ...dictation,
    start: () => {
      base.current = null
      capture()
      start()
    },
    toggle: () => {
      if (dictation.phase === 'listening') dictation.stop()
      else {
        base.current = null
        capture()
        start()
      }
    },
  }
}
