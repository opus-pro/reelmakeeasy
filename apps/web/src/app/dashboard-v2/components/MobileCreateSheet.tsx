'use client'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Button, cn, Sheet, SheetContent, SheetTitle } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useState } from 'react'

import { CrossSmall, Loading } from '@/components/icons/core'
import {
  MobileOmniChatBoxInput,
  OmniChatBoxRef,
} from '@/components/omni-chat-box-v2/MobileOmniChatBoxInput'
import type { OmniBoxSettings } from '@/components/omni-chat-box-v2/omni-chat-box.types'
import { getIsSendingAtom } from '@/components/omni-chat-box-v2/state/atoms/domain/runtime'
import { MobileHeaderIcon } from '@/components/projects-v2/MobileHeaderIcon'
import type { CreateUseCaseKey, CreateWorkflow } from '@/constants/create-use-cases'
import { useFalsyAtomValue } from '@/lib/jotai-atom-utils'

import { dashboardChatBoxStateAtom } from '../state/dashboard-v2-atoms'

import { CreateUseCaseDropdown } from './CreateUseCaseDropdown'
import { MobileSettingsChips } from './MobileSettingsChips'

interface MobileCreateSheetProps {
  currentSettings: null | OmniBoxSettings
  disabled?: boolean
  // Read-only handle for submit() and settings chips. Populated by onChatBoxRef.
  omniChatBoxRef: React.RefObject<null | OmniChatBoxRef>
  onBeforeSubmit?: () => void
  // Callback ref bound to the input so the dashboard records chatbox state and the
  // mounted workflow (drives guest draft restore + use-case dialog logic).
  onChatBoxRef: React.Ref<OmniChatBoxRef>
  onClose: () => void
  onSettingsChange?: (settings: OmniBoxSettings) => void
  onUseCaseSelect: (key: CreateUseCaseKey) => void
  open: boolean
  pageType: CreateWorkflow | undefined
  placeholder?: string
  selectedUseCaseKey: CreateUseCaseKey
}

export function MobileCreateSheet({
  currentSettings,
  disabled = false,
  omniChatBoxRef,
  onBeforeSubmit,
  onChatBoxRef,
  onClose,
  onSettingsChange,
  onUseCaseSelect,
  open,
  pageType,
  placeholder,
  selectedUseCaseKey,
}: MobileCreateSheetProps) {
  const chatBoxState = useAtomValue(dashboardChatBoxStateAtom)
  // Same read as the desktop composer's submit button (ChatBoxSubmitButton): an
  // in-flight submission must disable this one too, or handleSubmit's silent
  // `if (isSending) return` swallows the tap with no feedback.
  const isSending = useFalsyAtomValue(chatBoxState && getIsSendingAtom(chatBoxState)) ?? false

  // The handle is a callback ref that the chatbox detaches and re-attaches as its
  // imperative handle is rebuilt, so it can read null at tap time. Optional
  // chaining alone made that a silent no-op; record it instead.
  const handleSubmitTap = useCallback(() => {
    if (!omniChatBoxRef.current) {
      return
    }
    omniChatBoxRef.current.submit()
  }, [omniChatBoxRef, selectedUseCaseKey])

  // Compose mode: textarea focused (keyboard up). Collapses the sheet to just the
  // textarea + a "Hide keyboard / Mention" row, hiding the rest of the chrome.
  const [composeMode, setComposeMode] = useState(false)

  // Reset compose whenever the sheet closes so it reopens in the full layout.
  useEffect(() => {
    if (!open) {
      setComposeMode(false)
    }
  }, [open])

  const omniPageType = pageType === 'story-mode' ? pageType : undefined

  return (
    <Sheet onOpenChange={(o) => !o && onClose()} open={open}>
      <SheetContent
        // No description: says so, so Radix doesn't warn about a missing one.
        aria-describedby={undefined}
        className={cn(
          'z-[70] flex flex-col gap-2 overflow-hidden bg-panel px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] backdrop-blur-none rounded-none',
          // The sheet is the whole /create page (reached via navigation, behind the
          // loading shimmer), not a popup over the dashboard -- so neutralize the
          // Sheet's default bottom slide-up by zeroing the open/close animation duration.
          'data-[state=open]:duration-0 data-[state=closed]:duration-0',
          // In compose, top-anchor to the visual viewport so the sheet stays above the
          // iOS keyboard (default bottom-anchored fixed would sit behind it).
          composeMode
            ? 'bottom-auto top-[var(--visual-viewport-offset-top,0px)] h-[var(--visual-viewport-height,100dvh)]'
            : 'h-dvh',
        )}
        onInteractOutside={(e) => e.preventDefault()}
        overlayClassName="z-[69]"
        showClose={false}
      >
        {/* The sheet's name for screen readers: Radix wants its own Title here (a plain heading
            doesn't count, and it logs an error on every open without one). */}
        <VisuallyHidden>
          <SheetTitle>Create video</SheetTitle>
        </VisuallyHidden>

        {!composeMode && (
          <div className="flex shrink-0 items-center justify-between duration-150 animate-in fade-in-0">
            <CreateUseCaseDropdown
              disabled={disabled}
              mobileLayout
              onSelect={onUseCaseSelect}
              selectedUseCaseKey={selectedUseCaseKey}
            />
            <div className="flex items-center gap-2">
              <MobileHeaderIcon ariaLabel="Close" Icon={CrossSmall} onClick={onClose} />
            </div>
          </div>
        )}

        <CreateSheetInput
          composeMode={composeMode}
          omniPageType={omniPageType}
          onBeforeSubmit={onBeforeSubmit}
          onChatBoxRef={onChatBoxRef}
          onComposeChange={setComposeMode}
          onSettingsChange={onSettingsChange}
          placeholder={placeholder}
          selectedUseCaseKey={selectedUseCaseKey}
        />

        {!composeMode && (
          <div className="flex shrink-0 flex-col gap-4 duration-150 animate-in fade-in-0">
            <div className="flex flex-col gap-2">
              <MobileSettingsChips
                currentSettings={currentSettings}
                omniChatBoxRef={omniChatBoxRef}
                pageType={omniPageType}
              />
            </div>
            <Button
              className={cn(
                'h-12 w-full rounded-full text-base font-medium',
                isSending
                  ? 'bg-white/10 text-white/50'
                  : 'bg-white text-black md:hover:bg-white/90',
              )}
              data-dd-action="mobile-submit-prompt-button"
              disabled={disabled || isSending}
              onClick={handleSubmitTap}
              type="button"
              variant="base"
            >
              {isSending ? (
                <>
                  <Loading className="size-5 animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate video'
              )}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// The sheet's input surface: cards + textarea + compose row managed internally.
function CreateSheetInput({
  composeMode,
  omniPageType,
  onBeforeSubmit,
  onChatBoxRef,
  onComposeChange,
  onSettingsChange,
  placeholder,
  selectedUseCaseKey,
}: {
  composeMode: boolean
  omniPageType: CreateWorkflow | undefined
  onBeforeSubmit?: () => void
  onChatBoxRef: React.Ref<OmniChatBoxRef>
  onComposeChange: (value: boolean) => void
  onSettingsChange?: (settings: OmniBoxSettings) => void
  placeholder?: string
  selectedUseCaseKey: CreateUseCaseKey
}) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <MobileOmniChatBoxInput
        autoFocus={false}
        className="w-full rounded-none bg-white/10 shadow-none backdrop-blur-none"
        composeMode={composeMode}
        key={selectedUseCaseKey}
        onBeforeSubmit={onBeforeSubmit}
        onComposeChange={onComposeChange}
        onSettingsChange={onSettingsChange}
        pageType={omniPageType}
        placeholder={placeholder}
        ref={onChatBoxRef}
        useCaseKey={selectedUseCaseKey}
      />
    </div>
  )
}
