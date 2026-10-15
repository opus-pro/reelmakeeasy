'use client'

import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@shared/ui'
import React, { useCallback, useImperativeHandle, useMemo, useState } from 'react'

import { Cross } from '@/components/icons/core'

import { SettingsTriggerButton } from './shared/SettingsTriggerButton'
import { entryRenderers } from './entries'
import type { DrawerView, SettingsEntry } from './types'

/** Map DrawerView to entry type for finding the corresponding entry */
const VIEW_TO_ENTRY_TYPE: Record<Exclude<DrawerView, 'main'>, SettingsEntry['type']> = {
  caption: 'caption',
  ratio: 'ratio',
  'source-filter': 'source-filter',
  voice: 'voice',
}

/** Entry types that need full screen height */
const FULL_HEIGHT_ENTRY_TYPES: SettingsEntry['type'][] = ['source-filter', 'voice']

export interface DrawerSettingsMenuRef {
  openEntry: (type: SettingsEntry['type']) => void
}

interface DrawerSettingsMenuProps {
  disabled: boolean
  entries: SettingsEntry[]
  onSourceFilterClick?: () => void
}

export const DrawerSettingsMenu = React.forwardRef<DrawerSettingsMenuRef, DrawerSettingsMenuProps>(
  function DrawerSettingsMenu({ disabled, entries, onSourceFilterClick }, ref) {
    const [isOpen, setIsOpen] = useState(false)
    // Separate states to allow close animation to complete before unmounting content
    const [subSheetOpen, setSubSheetOpen] = useState(false)
    const [displayedEntryType, setDisplayedEntryType] = useState<null | SettingsEntry['type']>(null)

    // Derive displayedEntry from entries to ensure it always reflects the latest state
    const displayedEntry = useMemo(
      () =>
        displayedEntryType ? (entries.find((e) => e.type === displayedEntryType) ?? null) : null,
      [displayedEntryType, entries],
    )

    /** Handle navigation from menu item - find the entry by view type */
    const handleNavigate = useCallback(
      (view: DrawerView) => {
        if (view === 'main') {
          setSubSheetOpen(false)
          return
        }
        // For source filter, trigger the protected click handler from parent
        if (view === 'source-filter' && onSourceFilterClick) {
          onSourceFilterClick()
          return
        }
        const entryType = VIEW_TO_ENTRY_TYPE[view]
        setDisplayedEntryType(entryType)
        setSubSheetOpen(true)
      },
      [onSourceFilterClick],
    )

    const handleCloseMain = useCallback(() => {
      setIsOpen(false)
      setSubSheetOpen(false)
    }, [])

    const handleCloseSub = useCallback(() => {
      setSubSheetOpen(false)
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        openEntry(type: SettingsEntry['type']) {
          if (type === 'source-filter') {
            onSourceFilterClick?.()
            return
          }
          const found = entries.find((e) => e.type === type)
          if (!found) {
            return
          }
          setDisplayedEntryType(type)
          setSubSheetOpen(true)
        },
      }),
      [entries, onSourceFilterClick],
    )

    /** Determine if sub drawer needs full height */
    const isFullHeight = useMemo(
      () => displayedEntry && FULL_HEIGHT_ENTRY_TYPES.includes(displayedEntry.type),
      [displayedEntry],
    )

    /** Sub drawer title based on displayed entry type */
    const subDrawerTitle = useMemo(() => {
      switch (displayedEntry?.type) {
        case 'caption': {
          return 'Captions'
        }
        case 'ratio': {
          return 'Aspect Ratio'
        }
        case 'source-filter': {
          return 'Source Filter'
        }
        case 'voice': {
          return 'Voiceover'
        }
        default: {
          return ''
        }
      }
    }, [displayedEntry?.type])

    return (
      <>
        <SettingsTriggerButton
          active={isOpen}
          disabled={disabled}
          onClick={() => setIsOpen(true)}
        />

        {/* Main Menu Sheet */}
        <Sheet onOpenChange={(o) => !o && handleCloseMain()} open={isOpen}>
          <SheetContent className="max-h-screen overflow-hidden pt-3 pb-10" showClose={false}>
            <SheetTitle>
              <div className="relative h-9 mb-3 flex items-center justify-center">
                <span className="text-primary text-base font-medium">Settings</span>
                <button
                  className="absolute left-4 top-0 size-9.5 flex items-center justify-center rounded-full bg-fill-secondary backdrop-blur-2xl"
                  onClick={handleCloseMain}
                >
                  <Cross className="size-4" />
                </button>
              </div>
            </SheetTitle>
            <VisuallyHidden>
              <SheetDescription>Settings</SheetDescription>
            </VisuallyHidden>
            <div className="flex flex-col">
              {entries.map((entry, index) => {
                const renderer = entryRenderers[entry.type]
                return (
                  <React.Fragment key={`${entry.type}-${index}`}>
                    {renderer.renderDrawerMenuItem({
                      entry,
                      onNavigate: handleNavigate,
                    })}
                  </React.Fragment>
                )
              })}
            </div>
          </SheetContent>
        </Sheet>

        {/* Sub Page Sheet (Nested) */}
        <Sheet onOpenChange={(open) => !open && handleCloseSub()} open={subSheetOpen}>
          <SheetContent
            className={isFullHeight ? 'h-[93dvh] pt-3 pb-10' : 'max-h-screen pt-3 pb-10'}
            showClose={false}
          >
            <VisuallyHidden>
              <SheetTitle>{subDrawerTitle}</SheetTitle>
              <SheetDescription>{subDrawerTitle}</SheetDescription>
            </VisuallyHidden>
            {displayedEntry &&
              entryRenderers[displayedEntry.type].renderDrawerSubPage?.({
                entry: displayedEntry,
                onBack: handleCloseSub,
              })}
          </SheetContent>
        </Sheet>
      </>
    )
  },
)
