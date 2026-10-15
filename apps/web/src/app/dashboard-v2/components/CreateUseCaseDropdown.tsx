'use client'

import { Button, cn, Popover } from '@shared/ui'
import { useState } from 'react'

import { CheckMark, ChevronDownSmall } from '@/components/icons/core'
import {
  CREATE_USE_CASES,
  type CreateUseCaseKey,
  getCreateUseCase,
  isFocusedCreateUseCaseKey,
} from '@/constants/create-use-cases'

const MENU_ROW_CLASS_NAME =
  'flex h-9.5 w-full items-center justify-start gap-2 rounded-sm px-2.5 text-left text-sm font-medium leading-[17px] text-primary transition-colors md:hover:bg-fill-hover'

interface CreateUseCaseDropdownProps {
  disabled: boolean
  mobileLayout?: boolean
  onSelect: (key: CreateUseCaseKey) => void
  selectedUseCaseKey: CreateUseCaseKey
}

export function CreateUseCaseDropdown({
  disabled,
  onSelect,
  selectedUseCaseKey,
  mobileLayout = false,
}: CreateUseCaseDropdownProps) {
  const [open, setOpen] = useState(false)
  const selectedUseCase = getCreateUseCase(selectedUseCaseKey)

  // The mobile create sheet hides the focused-door use cases (News/Article) --
  // they are reached via their own door, not the sheet.
  const dropdownUseCases = CREATE_USE_CASES.filter(
    (useCase) => !mobileLayout || !isFocusedCreateUseCaseKey(useCase.key),
  )

  const handleSelect = (nextUseCaseKey: CreateUseCaseKey) => {
    setOpen(false)
    onSelect(nextUseCaseKey)
  }

  return (
    <Popover
      align="start"
      className="z-[100] w-[240px] rounded-2xl border-0 bg-menu-background p-1.5 text-primary shadow-none backdrop-blur-2xl"
      content={
        <div aria-label="Create use cases" className="flex flex-col" role="menu">
          {dropdownUseCases.map((useCase) => {
            const isSelected = useCase.key === selectedUseCaseKey
            return (
              <button
                aria-checked={isSelected}
                className={cn(MENU_ROW_CLASS_NAME, disabled && 'cursor-not-allowed opacity-50')}
                disabled={disabled}
                key={useCase.key}
                onClick={() => handleSelect(useCase.key)}
                role="menuitemradio"
                type="button"
              >
                <span className="min-w-0 flex-1 truncate">{useCase.sidebarLabel}</span>
                {isSelected && <CheckMark className="size-4.5 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      }
      modal={mobileLayout}
      onOpenChange={setOpen}
      open={open}
      side="bottom"
      sideOffset={8}
    >
      <Button
        aria-label="Select create use case"
        className={cn(
          'flex min-w-0 max-w-full items-center gap-1 rounded-full bg-transparent px-0 py-0 leading-5 text-primary transition-colors',
          'text-lg font-semibold md:text-sm md:font-medium',
        )}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        type="button"
        variant="default"
      >
        <span className="min-w-0 truncate">{selectedUseCase.sidebarLabel}</span>
        <ChevronDownSmall
          className={cn(
            'shrink-0 text-primary transition-transform',
            'size-[var(--mobile-icon-size)] md:size-4',
            open && 'rotate-180',
          )}
        />
      </Button>
    </Popover>
  )
}
