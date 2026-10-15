'use client'

import React, { useCallback, useImperativeHandle, useRef, useState } from 'react'

import { SourceFilterDialog } from '../../source-filter/SourceFilterDialog'

import { DrawerSettingsMenu, type DrawerSettingsMenuRef } from './DrawerSettingsMenu'
import { PopoverSettingsMenu } from './PopoverSettingsMenu'
import type { SettingsDropdownMenuProps, SettingsEntry, SourceFilterEntry } from './types'

export interface SettingsDropdownMenuRef {
  openEntry: (type: SettingsEntry['type']) => void
}

export const SettingsDropdownMenu = React.forwardRef<
  SettingsDropdownMenuRef,
  SettingsDropdownMenuProps
>(function SettingsDropdownMenu({ variant, entries, disabled = false }, ref) {
  const [isSourceFilterDialogOpen, setIsSourceFilterDialogOpen] = useState(false)
  const drawerRef = useRef<DrawerSettingsMenuRef | null>(null)

  const sourceFilterEntry = entries.find((e) => e.type === 'source-filter') as
    | SourceFilterEntry
    | undefined

  const handleSourceFilterClick = useCallback(() => {
    setIsSourceFilterDialogOpen(true)
  }, [])

  // openEntry only targets the drawer (mobile) variant. The popover (desktop)
  // variant mounts no DrawerSettingsMenu, so drawerRef is null and this no-ops.
  // Add a popover open path here if desktop settings deep-linking is needed.
  useImperativeHandle(
    ref,
    () => ({
      openEntry(type: SettingsEntry['type']) {
        drawerRef.current?.openEntry(type)
      },
    }),
    [],
  )

  return (
    <>
      {variant === 'drawer' ? (
        <DrawerSettingsMenu
          disabled={disabled}
          entries={entries}
          onSourceFilterClick={handleSourceFilterClick}
          ref={drawerRef}
        />
      ) : (
        <PopoverSettingsMenu
          disabled={disabled}
          entries={entries}
          onSourceFilterClick={handleSourceFilterClick}
        />
      )}
      {sourceFilterEntry && (
        <SourceFilterDialog
          onOpenChange={setIsSourceFilterDialogOpen}
          onSave={sourceFilterEntry.onSave}
          open={isSourceFilterDialogOpen}
        />
      )}
    </>
  )
})

export type { SettingsDropdownMenuProps, SettingsEntry } from './types'

export default SettingsDropdownMenu
