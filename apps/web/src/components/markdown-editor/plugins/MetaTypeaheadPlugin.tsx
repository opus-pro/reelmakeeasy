import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { cn, PopoverAnchor, PopoverContent, PopoverRoot } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { $createTextNode, $getSelection, $isRangeSelection, TextNode } from 'lexical'
import { type RefObject, useCallback, useMemo, useState } from 'react'
import ReactDOM from 'react-dom'

import { embeddedMetaTagsAtom } from '@/atom/inputBox'
import { Add, Camera, File, Music } from '@/components/icons/core'

import { $createMetaTagNode, ResourceType } from '../custom-nodes/MetaTagNode'

type Measurable = { getBoundingClientRect: () => DOMRect }

type MenuSourceType = ResourceType
type TriggerMenuOption = MetaOption

const TRIGGER = '@'

// Fuzzy match function: check if all characters in query appear in order in text
const fuzzyMatch = (query: string, text: string): boolean => {
  if (!query) {
    return false
  }
  const lowerQuery = query.toLowerCase()
  const lowerText = text.toLowerCase()
  let queryIndex = 0
  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      queryIndex++
    }
  }
  return queryIndex === lowerQuery.length
}

export const getFileIcon = (type: MenuSourceType | undefined) => {
  switch (type) {
    case 'audio':
    case 'vo': {
      return Music
    }
    case 'video': {
      return Camera
    }
    default: {
      return File
    }
  }
}

/**
 * A typeahead candidate injected by a caller (e.g. an @-mention picker
 * over session uploads). Shape is the subset of `embeddedMetaTagsAtom` items the
 * menu actually reads. When `candidates` is omitted the plugin falls back to the
 * `embeddedMetaTagsAtom`, so every existing caller is unaffected.
 */
export type MentionMenuVariant = 'default' | 'mobile-sheet'

export type MetaTypeaheadCandidate = {
  title: string
  type: ResourceType
  url?: string
  value: string
}

export type MetaTypeaheadPluginProps = {
  /**
   * When provided, drives the typeahead from this list instead of the
   * `embeddedMetaTagsAtom`, e.g. to offer the session's uploaded
   * assets as `@` mentions.
   */
  candidates?: MetaTypeaheadCandidate[]
  mentionMenuVariant?: MentionMenuVariant
  /** When provided, renders an "Upload new asset" row at the bottom of the menu. */
  onUploadNewAsset?: () => void
}

class MetaOption extends MenuOption {
  title: string
  type: ResourceType
  url?: string
  value: string

  constructor(title: string, value: string, type: ResourceType, previewUrl?: string, file?: File) {
    super(title)
    this.title = title
    this.value = value
    this.type = type
    this.url = previewUrl || (file ? URL.createObjectURL(file) : undefined)
  }
}

export function MetaTypeaheadPlugin({
  candidates,
  mentionMenuVariant = 'default',
  onUploadNewAsset,
}: MetaTypeaheadPluginProps = {}) {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<null | string>(null)
  const embeddedMetaTags = useAtomValue(embeddedMetaTagsAtom)
  // Injected `candidates` win when provided; otherwise fall back to the
  // embedded-meta-tags atom so every existing caller behaves exactly as before.
  const source = candidates ?? embeddedMetaTags

  const handleQueryChange = useCallback((query: null | string) => {
    setQueryString(query)
  }, [])

  const allOptions = useMemo<TriggerMenuOption[]>(() => {
    const options: MetaOption[] = []
    const uniqueIds = new Set<string>()
    for (const item of source) {
      const id = item.value?.trim()
      if (!id || uniqueIds.has(id)) {
        continue
      }
      uniqueIds.add(id)
      // `file` only exists on embedded-meta-tag items, not injected candidates
      // (which preview via `url`). Read it through an optional-typed view so the
      // union element doesn't widen the local to `unknown`.
      const file = (item as { file?: File }).file
      options.push(new MetaOption(item.title, id, item.type, item.url, file))
    }
    return options
  }, [source])

  const filteredOptions = useMemo(() => {
    if (!queryString) {
      return allOptions
    }
    return allOptions.filter((option) => {
      // Use fuzzy match for all options
      return fuzzyMatch(queryString, option.title)
    })
  }, [allOptions, queryString])

  const onSelectOption = useCallback(
    (selectedOption: TriggerMenuOption, nodeToRemove: null | TextNode, closeMenu: () => void) => {
      editor.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          if (nodeToRemove) {
            nodeToRemove.remove()
          }
          const metaNode = $createMetaTagNode({
            resourceId: selectedOption.value,
            resourceType: selectedOption.type,
            title: selectedOption.title,
          })
          selection.insertNodes([metaNode, $createTextNode(' ')])
        }
        closeMenu()
      })
    },
    [editor],
  )

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch(TRIGGER, {
    minLength: 0,
  })
  const checkForMentionMatch = useCallback(
    (text: string) => {
      const slashMatch = checkForTriggerMatch(text, editor)
      if (slashMatch != null) {
        return slashMatch
      }
      return null
    },
    [checkForTriggerMatch, editor],
  )

  const renderMenuOption = (option: TriggerMenuOption) => {
    const FileIcon = getFileIcon(option.type)
    const isMobileSheetMenu = mentionMenuVariant === 'mobile-sheet'
    return (
      <>
        {/* Only images get a thumbnail: a video's url is the .mp4 itself, which an
            <img> can't render (shows a broken-image icon). Use the type icon for
            video and everything else. The message chip renders its own preview. */}
        {option.url && option.type === 'img' ? (
          <img
            alt={option.title}
            className={cn(isMobileSheetMenu ? 'size-[18px]' : 'size-4.5', 'rounded object-cover')}
            src={option.url}
          />
        ) : (
          FileIcon && (
            <FileIcon className={cn(isMobileSheetMenu ? 'size-[18px]' : 'size-4.5', 'rounded')} />
          )
        )}
        <div className="flex-1 truncate text-sm">{option.title}</div>
      </>
    )
  }

  return (
    <LexicalTypeaheadMenuPlugin
      menuRenderFn={(
        anchorElem,
        { options, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => {
        if (!anchorElem.current || (options.length === 0 && !onUploadNewAsset)) {
          return null
        }

        const isMobileSheetMenu = mentionMenuVariant === 'mobile-sheet'

        const menuItems = (
          <>
            {options.map((option: TriggerMenuOption, i) => {
              const focused = i === selectedIndex
              return (
                <li
                  className={cn(
                    'flex items-center cursor-pointer whitespace-nowrap font-medium',
                    isMobileSheetMenu
                      ? 'gap-2 rounded-md px-2 py-1.5'
                      : 'gap-2 p-2.5 rounded-md text-sm',
                    focused ? 'bg-fill-hover' : 'bg-transparent text-secondary',
                  )}
                  key={option.key}
                  // Select on click, not pointerdown: selecting unmounts the menu,
                  // so doing it on pointerdown lets the trailing tap fall through to
                  // whatever is now behind the (closed) menu. onMouseDown only
                  // prevents the editor from losing focus.
                  onClick={() => selectOptionAndCleanUp(option)}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlightedIndex(i)}
                >
                  {renderMenuOption(option)}
                </li>
              )
            })}
            {onUploadNewAsset && (
              <li
                className={cn(
                  'flex cursor-pointer items-center rounded-md font-medium text-primary whitespace-nowrap',
                  isMobileSheetMenu ? 'gap-1.5 px-2 py-1.5 text-sm' : 'gap-2 p-2.5 text-base',
                )}
                onClick={() => {
                  onUploadNewAsset()
                  // Remove the @query text so Lexical's update listener closes the menu
                  editor.update(() => {
                    const selection = $getSelection()
                    if ($isRangeSelection(selection) && selection.isCollapsed()) {
                      const anchor = selection.anchor
                      const node = anchor.getNode()
                      if (node instanceof TextNode) {
                        const offset = anchor.offset
                        const atIdx = node.getTextContent().slice(0, offset).lastIndexOf('@')
                        if (atIdx !== -1) {
                          node.spliceText(atIdx, offset - atIdx, '')
                        }
                      }
                    }
                  })
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <Add className={cn('shrink-0 text-primary size-4.5')} />
                Upload new asset
              </li>
            )}
          </>
        )

        // Mobile sheet: anchor a Radix Popover to the caret so its built-in
        // collision handling shifts the menu back on-screen near the right edge.
        // Lexical's own clamp measures against the editor root, which
        // on a full-screen composer spans the viewport, so it never fires in time.
        if (isMobileSheetMenu) {
          // Point Radix at Lexical's caret element as a virtual anchor, so Radix
          // handles positioning and portaling for us. Collapse its height to 0:
          // Lexical already shifts this element a line below the caret, so anchoring
          // `side="bottom"` to its full box would add a second line of gap.
          const caretAnchor: RefObject<Measurable> = {
            current: {
              getBoundingClientRect: () => {
                const el = anchorElem.current
                if (!el) {
                  return new DOMRect()
                }
                const r = el.getBoundingClientRect()
                return new DOMRect(r.left, r.top, r.width, 0)
              },
            },
          }
          return (
            <PopoverRoot modal={false} open>
              <PopoverAnchor virtualRef={caretAnchor} />
              <PopoverContent
                align="start"
                // pointer-events-auto re-enables interaction: after Radix Dialog sets body: { pointer-events: none }
                className="mentions-menu pointer-events-auto z-[80] w-[215px] max-w-[calc(100vw-16px)] rounded-sm border-none bg-secondary/90 p-1 shadow-[0px_12px_60px_0px_rgba(0,0,0,0.30)] backdrop-blur-[80px] [-webkit-backdrop-filter:blur(80px)]"
                collisionPadding={8}
                onCloseAutoFocus={(e) => e.preventDefault()}
                onOpenAutoFocus={(e) => e.preventDefault()}
                side="bottom"
                sideOffset={4}
              >
                <ul className="typeahead-popover">{menuItems}</ul>
              </PopoverContent>
            </PopoverRoot>
          )
        }

        return ReactDOM.createPortal(
          <ul className="typeahead-popover mentions-menu absolute z-[80] w-[236px] rounded-2xl bg-secondary p-1.5 backdrop-blur-3xl">
            {menuItems}
          </ul>,
          anchorElem.current,
        )
      }}
      onQueryChange={handleQueryChange}
      onSelectOption={onSelectOption}
      options={filteredOptions}
      triggerFn={checkForMentionMatch}
    />
  )
}
