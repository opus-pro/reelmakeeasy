'use client'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { cn } from '@shared/ui'
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ESCAPE_COMMAND,
  type TextNode,
} from 'lexical'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom'

import {
  $createMetaTagNode,
  type ResourceType,
} from '@/components/markdown-editor/custom-nodes/MetaTagNode'

import type { AssetRef } from '../../state-types'

const TYPEAHEAD_TRIGGER = '@'

class AssetOption extends MenuOption {
  label: string
  previewUrl?: string
  resourceType: ResourceType

  constructor(asset: AssetRef) {
    super(asset.id)
    this.label = asset.label
    this.previewUrl = asset.previewUrl
    this.resourceType = asset.type as ResourceType
  }
}

const fuzzyMatch = (query: string, text: string): boolean => {
  if (!query) {
    return false
  }
  const lq = query.toLowerCase()
  const lt = text.toLowerCase()
  let qi = 0
  for (let i = 0; i < lt.length && qi < lq.length; i++) {
    if (lt[i] === lq[qi]) {
      qi++
    }
  }
  return qi === lq.length
}

export function AssetTypeaheadPlugin({ assets }: { assets?: AssetRef[] }) {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<null | string>(null)
  const [cursorRect, setCursorRect] = useState<DOMRect | null>(null)
  const popupRef = useRef<HTMLUListElement>(null)

  const isOpenRef = useRef(false)
  isOpenRef.current = cursorRect !== null

  // Native mousedown on popup - prevents editor from losing focus when clicking options
  useEffect(() => {
    if (!cursorRect) {
      return
    }
    const popup = popupRef.current
    if (!popup) {
      return
    }
    const prevent = (e: MouseEvent) => e.preventDefault()
    popup.addEventListener('mousedown', prevent)
    return () => popup.removeEventListener('mousedown', prevent)
  }, [cursorRect])

  // Close popup when editor loses focus outside the popup
  useEffect(() => {
    const editorRoot = editor.getRootElement()
    if (!editorRoot) {
      return
    }
    const handleBlur = (e: FocusEvent) => {
      if (!isOpenRef.current) {
        return
      }
      const next = e.relatedTarget as Node | null
      if (next && popupRef.current?.contains(next)) {
        return
      }
      editor.dispatchCommand(
        KEY_ESCAPE_COMMAND,
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }),
      )
    }
    editorRoot.addEventListener('blur', handleBlur)
    return () => editorRoot.removeEventListener('blur', handleBlur)
  }, [editor])

  const allOptions = useMemo<AssetOption[]>(
    () => (assets || []).map((a) => new AssetOption(a)),
    [assets],
  )

  const filteredOptions = useMemo(
    () => (queryString ? allOptions.filter((o) => fuzzyMatch(queryString, o.label)) : allOptions),
    [allOptions, queryString],
  )

  const onSelectOption = useCallback(
    (option: AssetOption, nodeToRemove: null | TextNode, closeMenu: () => void) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          return
        }
        if (nodeToRemove) {
          nodeToRemove.remove()
        }
        selection.insertNodes([
          $createMetaTagNode({
            previewUrl: option.previewUrl,
            resourceId: option.key,
            resourceType: option.resourceType,
            title: option.label,
          }),
          $createTextNode(' '),
        ])
        closeMenu()
      })
    },
    [editor],
  )

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch(TYPEAHEAD_TRIGGER, { minLength: 0 })
  const triggerFn = useCallback(
    (text: string) => checkForTriggerMatch(text, editor),
    [checkForTriggerMatch, editor],
  )

  return (
    <LexicalTypeaheadMenuPlugin
      commandPriority={COMMAND_PRIORITY_CRITICAL}
      menuRenderFn={(
        anchorElem,
        { options, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => {
        if (!anchorElem.current || options.length === 0 || !cursorRect) {
          return null
        }

        const spaceBelow = window.innerHeight - cursorRect.bottom
        const openUpward = spaceBelow < 200
        const left = Math.min(cursorRect.left, window.innerWidth - 244)

        return ReactDOM.createPortal(
          <ul
            className="bg-secondary rounded-2xl p-1.5 backdrop-blur-3xl"
            ref={popupRef}
            style={{
              left,
              pointerEvents: 'auto',
              position: 'fixed',
              width: 236,
              zIndex: 200,
              ...(openUpward
                ? { bottom: window.innerHeight - cursorRect.top + 4 }
                : { top: cursorRect.bottom + 4 }),
            }}
          >
            {options.map((option: AssetOption, i) => {
              const focused = i === selectedIndex
              return (
                <li
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md p-2.5 text-sm font-medium whitespace-nowrap',
                    focused ? 'bg-fill-hover' : 'bg-transparent text-secondary',
                  )}
                  key={option.key}
                  onClick={() => selectOptionAndCleanUp(option)}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlightedIndex(i)}
                >
                  {option.previewUrl && option.resourceType === 'img' ? (
                    <img
                      alt={option.label}
                      className="size-4.5 rounded object-cover"
                      src={option.previewUrl}
                    />
                  ) : null}
                  <span className="flex-1 truncate">{option.label}</span>
                </li>
              )
            })}
          </ul>,
          document.body,
        )
      }}
      onClose={() => setCursorRect(null)}
      onOpen={(resolution) => setCursorRect(resolution.getRect())}
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      options={filteredOptions}
      triggerFn={triggerFn}
    />
  )
}
