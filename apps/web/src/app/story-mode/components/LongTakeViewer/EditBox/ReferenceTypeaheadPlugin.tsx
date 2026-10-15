import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { cn } from '@shared/ui'
import { $createTextNode, $getSelection, $isRangeSelection, TextNode } from 'lexical'
import { useCallback, useMemo } from 'react'
import ReactDOM from 'react-dom'

import { $createMetaTagNode } from '@/components/markdown-editor/custom-nodes/MetaTagNode'

const TRIGGER = '@'

export type ReferenceTypeaheadOption = {
  previewUrl: string
  resourceId: string
  title: string
}

class ReferenceOption extends MenuOption {
  previewUrl: string
  resourceId: string
  title: string

  constructor(option: ReferenceTypeaheadOption) {
    super(option.resourceId)
    this.previewUrl = option.previewUrl
    this.resourceId = option.resourceId
    this.title = option.title
  }
}

export function ReferenceTypeaheadPlugin({ option }: { option: null | ReferenceTypeaheadOption }) {
  const [editor] = useLexicalComposerContext()
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch(TRIGGER, {
    minLength: 0,
  })

  const options = useMemo(() => {
    if (!option) {
      return []
    }
    return [new ReferenceOption(option)]
  }, [option])

  const filteredOptions = useMemo(() => {
    if (!option) {
      return []
    }
    return options
  }, [option, options])

  const triggerFn = useCallback(
    (text: string) => {
      if (!option) {
        return null
      }
      const match = checkForTriggerMatch(text, editor)
      if (!match) {
        return null
      }
      return matchesQuery(match.matchingString, option.title) ? match : null
    },
    [checkForTriggerMatch, editor, option],
  )

  const onSelectOption = useCallback(
    (selectedOption: ReferenceOption, nodeToRemove: null | TextNode, closeMenu: () => void) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          return
        }

        nodeToRemove?.remove()
        selection.insertNodes([
          $createMetaTagNode({
            previewUrl: selectedOption.previewUrl,
            resourceId: selectedOption.resourceId,
            resourceType: 'img',
            title: selectedOption.title,
          }),
          $createTextNode(' '),
        ])
        closeMenu()
      })
    },
    [editor],
  )

  return (
    <LexicalTypeaheadMenuPlugin
      menuRenderFn={(
        anchorElem,
        { options: menuOptions, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => {
        if (!anchorElem.current || menuOptions.length === 0) {
          return null
        }

        anchorElem.current.removeAttribute('inert')
        anchorElem.current.removeAttribute('aria-hidden')
        anchorElem.current.style.pointerEvents = 'auto'

        return ReactDOM.createPortal(
          <div className="typeahead-popover mentions-menu">
            <ul className="absolute z-50 min-w-[180px] rounded-xl border border-subtle bg-secondary p-1 shadow-2xl backdrop-blur-xl">
              {menuOptions.map((menuOption, index) => {
                const focused = index === selectedIndex

                return (
                  <li
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm',
                      focused ? 'bg-fill-hover text-primary' : 'text-primary',
                    )}
                    key={menuOption.key}
                    onClick={() => selectOptionAndCleanUp(menuOption)}
                    onMouseDown={(event) => {
                      event.preventDefault()
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <img
                      alt={menuOption.title}
                      className="size-6 rounded object-cover"
                      src={menuOption.previewUrl}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{menuOption.title}</div>
                      <div className="truncate text-xs text-secondary">@reference</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>,
          anchorElem.current,
        )
      }}
      onQueryChange={() => undefined}
      onSelectOption={onSelectOption}
      options={filteredOptions}
      triggerFn={triggerFn}
    />
  )
}

function matchesQuery(query: string, title: string): boolean {
  if (!query) {
    return true
  }
  return title.toLowerCase().includes(query.toLowerCase())
}
