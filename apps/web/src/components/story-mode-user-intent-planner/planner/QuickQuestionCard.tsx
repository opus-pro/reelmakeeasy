'use client'

import {
  cn,
  FREE_TEXT_PILL_INPUT_CLASS,
  FREE_TEXT_PILL_PLACEHOLDER_CLASS,
  FreeTextPill,
  OptionList,
} from '@shared/ui'
import { QuestionCard } from '@shared/ui/chat'
import { useAtomValue } from 'jotai'
import { ArrowUp, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Edit } from '@/components/icons/core'
import { isIOS } from '@/util/browser-env'
import { useIsMobile } from '@/util/browserUtils'

import { FONT_FEATURE_SETTINGS } from '../defaults'
import {
  enqueueDraftFileUploads,
  enqueueDraftFileUploadsForOption,
} from '../state/actions/draft-upload-actions'
import {
  clearComposerDraft,
  submitDraftMessage,
  submitQuickOption,
} from '../state/actions/flow-actions'
import {
  getDraftFileUploadsAtom,
  getDraftMessageAtom,
  getRenderStateAtom,
} from '../state/atoms/planner'
import { getCanSubmitComposerAtom, getQuickQuestionCardModelAtom } from '../state/computed/planner'
import { usePlannerState } from '../state/planner-context'
import type { StoryModeQuickQuestionCardModel } from '../state-types'

import { DraftUploadThumbnailList } from './quick-question-card/DraftUploadThumbnailList'
import { GlowBorderFrame } from './GlowBorderFrame'
import { MessageTextArea } from './MessageTextArea'

// iOS may auto-zoom focused editable text below 16px.
// In this file, editable text on iOS should use 16px-equivalent classes to prevent zoom.

type QuickQuestionOption = StoryModeQuickQuestionCardModel['options'][number]

export function QuickQuestionCard({
  shouldUseCanvasStyle,
}: {
  // The canvas-vs-legacy surface, threaded from the planner rather than re-derived, so the
  // polished option rows only ever render on the surface that was designed for them.
  shouldUseCanvasStyle?: boolean
}) {
  const state = usePlannerState()
  const isMobile = useIsMobile()
  const isIOSDevice = isIOS()
  const card = useAtomValue(getQuickQuestionCardModelAtom(state))
  const quickQuestionMessageId = useAtomValue(getRenderStateAtom(state)).quickQuestionMessageId
  const optionRowPolishEnabled = Boolean(shouldUseCanvasStyle)

  // A new question card means any leftover draft was meant for the prior turn.
  // The unmount cleanup catches the late OnChangePlugin write-back that the
  // CustomOptionRow editor can fire after submit, which would otherwise leak
  // the typed text into MessageBoxV2 when this card unmounts.
  useEffect(() => {
    clearComposerDraft(state)
    return () => {
      clearComposerDraft(state)
    }
  }, [quickQuestionMessageId, state])

  const assetFileInputRef = useRef<HTMLInputElement>(null)
  const pendingOptionRef = useRef<(typeof card.options)[0] | null>(null)

  function submitOrUpload(option: QuickQuestionOption) {
    if (option.expectAssets) {
      pendingOptionRef.current = option
      assetFileInputRef.current?.click()
      return
    }
    void submitQuickOption(state, option.id)
  }

  function onSelect(_label: string, row: { id?: string }) {
    const option = card.options.find((o) => o.id === row.id)
    if (option) {
      submitOrUpload(option)
    }
  }

  const freeText = card.showCustomOption ? (
    <CustomOptionRow
      assetFileInputRef={assetFileInputRef}
      pendingOptionRef={pendingOptionRef}
      shouldUseCanvasStyle={shouldUseCanvasStyle}
    />
  ) : undefined

  if (optionRowPolishEnabled) {
    return (
      <QuestionCard
        freeText={freeText}
        header={<StepIndicator />}
        optionList={{
          activation: 'immediate',
          onSelect,
          options: card.options.map((option) => ({
            badge: option.leadingLabel,
            id: option.id,
            label: option.text,
          })),
          rowTestId: (row) => `uip-option-${row.id}`,
        }}
        title={card.title}
      />
    )
  }

  return (
    <GlowBorderFrame
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
      data-testid="uip-quick-question-card"
    >
      <div className={cn('flex items-center gap-3', isMobile ? 'px-2 py-2.5' : 'px-2 py-3')}>
        <p
          className={cn(
            'flex-1 text-left font-medium leading-[20px] text-white',
            isMobile ? (isIOSDevice ? 'text-base' : 'text-[15px]') : 'text-base',
          )}
          style={FONT_FEATURE_SETTINGS}
        >
          {card.title}
        </p>

        <StepIndicator />
      </div>

      <div className="relative flex flex-col">
        <OptionList
          activation="immediate"
          activeBadgeClassName="bg-white/15"
          dividers={false}
          onSelect={onSelect}
          options={card.options.map((option) => ({
            badge: option.leadingLabel,
            endIcon: null,
            id: option.id,
            label: option.text,
          }))}
          rowTestId={(row) => `uip-option-${row.id}`}
        />

        {/* CustomOptionRow must stay a sibling of OptionList, never its `trailing` prop:
            OptionList's window Enter listener only leaves Enter alone for interactive controls
            outside its own div, and `trailing` renders inside it. Passing the row through
            `trailing` would let Enter in its textarea or submit button activate the highlighted
            option instead. */}
        {freeText}
      </div>
    </GlowBorderFrame>
  )
}

function CustomOptionRow({
  assetFileInputRef,
  pendingOptionRef,
  shouldUseCanvasStyle,
  submitOn = 'enter',
}: {
  assetFileInputRef: React.RefObject<HTMLInputElement | null>
  pendingOptionRef: React.RefObject<null | QuickQuestionOption>
  shouldUseCanvasStyle?: boolean
  submitOn?: 'enter' | 'mod-enter'
}) {
  const state = usePlannerState()
  const isMobile = useIsMobile()
  const isIOSDevice = isIOS()
  const card = useAtomValue(getQuickQuestionCardModelAtom(state))
  const customDraft = useAtomValue(getDraftMessageAtom(state))
  const customInputCanSubmit = useAtomValue(getCanSubmitComposerAtom(state))
  const { quickQuestionMessageId } = useAtomValue(getRenderStateAtom(state))
  const optionRowPolishEnabled = Boolean(shouldUseCanvasStyle)

  function submit() {
    if (!customInputCanSubmit) {
      return
    }
    void submitDraftMessage(state, quickQuestionMessageId)
  }

  const uploadButton = (
    <>
      <button
        className={cn(
          'inline-flex h-9 min-w-9 self-start items-center justify-center rounded-[10px] bg-white/10 px-2.5 font-medium leading-[17px] text-white transition hover:bg-white/15 sm:h-9.5 sm:min-w-9.5',
          isIOSDevice ? 'text-base' : 'text-sm',
        )}
        onClick={() => {
          // Clear any option left pending by a cancelled asset-option pick so this custom
          // upload is not misattributed to that stale option in the shared input onChange.
          pendingOptionRef.current = null
          assetFileInputRef.current?.click()
        }}
        title="Upload asset"
        type="button"
      >
        <Plus aria-hidden className="size-[18px] shrink-0 text-white" />
      </button>
      <input
        accept="image/*"
        className="hidden"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          const pendingOption = pendingOptionRef.current
          pendingOptionRef.current = null
          if (files.length > 0) {
            if (
              pendingOption?.text &&
              !customDraft.trim() &&
              state.get(getDraftFileUploadsAtom).length === 0
            ) {
              enqueueDraftFileUploadsForOption(state, files, pendingOption.text)
              submitDraftMessage(state, quickQuestionMessageId)
            } else {
              enqueueDraftFileUploads(state, files)
            }
          }
          event.target.value = ''
        }}
        ref={assetFileInputRef}
        type="file"
      />
    </>
  )

  const textArea = (
    <div className="flex flex-1 flex-col justify-center">
      <MessageTextArea
        contentEditableClassName={cn(FREE_TEXT_PILL_INPUT_CLASS, 'min-h-[26px] p-0')}
        dataTestId="uip-option-custom-input"
        onChange={(value) => {
          state.set(getDraftMessageAtom, value)
        }}
        onEnterPress={submitOn === 'enter' ? submit : undefined}
        placeholder="Something else..."
        placeholderClassName={FREE_TEXT_PILL_PLACEHOLDER_CLASS}
        value={customDraft}
      />
    </div>
  )

  const thumbnailList = card.expectAssets ? <DraftUploadThumbnailList /> : null

  const submitButton = customInputCanSubmit ? (
    <button
      className="inline-flex h-9.5 min-w-9.5 self-end items-center justify-center rounded-full bg-white px-2.5 text-black"
      data-testid="uip-option-custom-submit"
      onClick={submit}
      type="button"
    >
      <ArrowUp className="size-4.5" strokeWidth={2.25} />
    </button>
  ) : null

  const handleKeyDown =
    submitOn === 'mod-enter'
      ? (event: React.KeyboardEvent) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          }
        }
      : undefined

  if (optionRowPolishEnabled) {
    return (
      <FreeTextPill
        className="w-full text-left"
        data-quick-question-custom-row
        leading={card.expectAssets ? uploadButton : undefined}
        onKeyDown={handleKeyDown}
        role="group"
      >
        {textArea}
        {thumbnailList}
        {submitButton}
      </FreeTextPill>
    )
  }

  return (
    <div
      className={cn(
        'flex w-full rounded-sm text-left transition-colors',
        isMobile ? 'gap-2 px-2 py-2' : 'gap-2.5 p-2',
        'text-white/50 hover:bg-white/8 focus-within:bg-white/8',
      )}
      data-quick-question-custom-row
      onKeyDown={handleKeyDown}
      role="group"
    >
      {card.expectAssets ? (
        uploadButton
      ) : (
        <span
          className={cn(
            'inline-flex h-9.5 min-w-9.5 self-start items-center justify-center rounded-[10px] bg-white/10 px-2.5 font-medium leading-[17px] text-white',
            isIOSDevice ? 'text-base' : 'text-sm',
          )}
        >
          <Edit aria-hidden className="size-[18px] shrink-0 text-white" />
        </span>
      )}
      {textArea}
      {thumbnailList}
      {submitButton}
    </div>
  )
}

function StepIndicator() {
  const state = usePlannerState()
  const isIOSDevice = isIOS()
  const card = useAtomValue(getQuickQuestionCardModelAtom(state))
  const stepIndicator = card.stepIndicator
  if (!stepIndicator) {
    return null
  }

  return (
    <div className="flex items-center gap-1 text-white/50">
      <ChevronLeft className="size-4" strokeWidth={1.5} />
      <span
        className={cn('font-normal leading-[22px]', isIOSDevice ? 'text-base' : 'text-sm')}
        style={FONT_FEATURE_SETTINGS}
      >
        {stepIndicator.current}
      </span>
      <span
        className={cn('font-normal leading-[22px]', isIOSDevice ? 'text-base' : 'text-sm')}
        style={FONT_FEATURE_SETTINGS}
      >
        /
      </span>
      <span
        className={cn('font-normal leading-[22px]', isIOSDevice ? 'text-base' : 'text-sm')}
        style={FONT_FEATURE_SETTINGS}
      >
        {stepIndicator.total}
      </span>
      <ChevronRight className="size-4" strokeWidth={1.5} />
    </div>
  )
}
