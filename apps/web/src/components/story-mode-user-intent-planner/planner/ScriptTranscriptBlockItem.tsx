'use client'

import { countWords, estimateDuration } from '@reelmakeeasy/common/utils/text'
import { cn } from '@shared/ui'
import {
  OutdatedCollapsedHeader,
  OutdatedCollapseToggle,
  UpdatedStatusBadge,
} from '@shared/ui/artifact-panel'
import { useAtom, useAtomValue } from 'jotai'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { ScriptContent, type ScriptWordCount } from '@/components/artifact-content/ScriptContent'
import { useStoryModeUserLimits } from '@/hooks/useStoryModeUserLimits'
import { useFetcherData } from '@/lib/jotai-fetcher-adapter'

import { FONT_FEATURE_SETTINGS } from '../defaults'
import { syncTranscriptEditingActive } from '../state/actions/flow-actions'
import {
  retryScriptTranscriptSave,
  saveScriptTranscriptEdits,
} from '../state/actions/script-transcript-flow'
import {
  getCanvasVoiceoverHasAudioAtom,
  getIsConfirmingScriptReviewGateAtom,
  getRenderStateAtom,
} from '../state/atoms/planner'
import {
  getScriptTranscriptDraftTextAtom,
  getScriptTranscriptIsFocusedAtom,
  getScriptTranscriptLastSuccessfulSavedTextAtom,
  getScriptTranscriptSavedTextAtom,
} from '../state/atoms/script-transcript'
import { getScriptTranscriptDraftTextByBlockTextAtom } from '../state/computed/script-transcript'
import { usePlannerState } from '../state/planner-context'
import type { PlannerState } from '../state/planner-state'
import {
  getScriptTranscriptStateByPlanner,
  type TranscriptEditScope,
} from '../state/script-transcript-state'
import type { ScriptTranscriptBlock } from '../state-types'
import { getAudioMetadataCacheByPlanner } from '../utils/audio-metadata-cache'

import { canEditScriptTranscript } from './scriptTranscriptEditGate'
import { useResetScriptOverridesOnServerChange } from './useResetScriptOverridesOnServerChange'
import { useTranscriptSaveDisplay } from './useTranscriptSaveDisplay'

interface ScriptTranscriptBlockItemProps {
  block: ScriptTranscriptBlock
  // When true (the uid_revamp Edit Script modal), the card chrome (border, background,
  // rounded corners, padding, fixed height) is dropped so the editor fills its host as a
  // single container instead of a box-inside-a-box. The modal owns the Save button in its
  // header. Defaults to false so the timeline and canvas Script section are unchanged.
  embedded?: boolean
  showHeader?: boolean
  // When true (the uid_revamp canvas Script section), the voice-preview editor is
  // suppressed so the card holds only the transcript -- voice lives in the canvas
  // Voiceover section. Defaults to false so the legacy timeline is unchanged.
  transcriptOnly?: boolean
}

interface ScriptTranscriptEditContext {
  audioSource?: 'user_audio' | null
  audioUrl?: string
  editScope: TranscriptEditScope
  plannerState: PlannerState
  transcriptText: string
}

interface ScriptTranscriptEditorContentProps {
  block: ScriptTranscriptBlock
  // The canvas Script section (transcriptOnly, non-embedded) shows the transcript as flat
  // read-only text -- like the Summary section -- with editing done in the Edit modal, so
  // the page view has no bordered textarea box.
  displayOnly: boolean
  editContext: ScriptTranscriptEditContext
  // The Edit modal (embedded) edits inline but flat: the textarea drops its border/background
  // box so the modal is one flat surface, matching the flattened page view.
  embedded: boolean
  // True only for the Transcript edit modal (embedded AND transcriptOnly), whose host is
  // stretched to the modal body. The Voiceover edit modal is embedded too but bounds its
  // content with a max-height, which gives a growing field nothing definite to stop at.
  fillsHost: boolean
  isCollapsed: boolean
}

interface ScriptTranscriptHeaderActionsProps {
  block: ScriptTranscriptBlock
  isCollapsed: boolean
  isOutdated: boolean
  onToggleOutdated: () => void
}

interface TranscriptStatusTextProps {
  // When true (uid_revamp canvas Script section and Edit modal), suppress the idle
  // "Review your transcript..." hint -- those surfaces don't want the instructional line
  // above the text. Transient save feedback and the audio notice still show.
  hideIdleHint: boolean
  // When true (the Transcript edit modal -- embedded AND transcriptOnly), suppress the transient
  // "Saving..." / "Saved!" lines: that modal's Save button carries the confirmation instead, so
  // the line stays reserved for the save-failure message and doesn't stand in place of the
  // transcript copy. The Voiceover edit modal is also embedded but has no Save button, so it
  // keeps the status line as its only save feedback.
  hideTransientSaveFeedback: boolean
  isActiveTranscriptBlock: boolean
  isAudioMode: boolean
  plannerState: PlannerState
}

export function ScriptTranscriptBlockItem({
  block,
  embedded = false,
  showHeader = true,
  transcriptOnly = false,
}: ScriptTranscriptBlockItemProps) {
  const isOutdated = block.blockStatus === 'outdated'
  const [isCollapsed, setIsCollapsed] = useState(isOutdated)
  const isOutdatedCollapsed = isOutdated && isCollapsed

  const plannerState = usePlannerState()
  const renderState = useAtomValue(getRenderStateAtom(plannerState))
  const latestScript = renderState.latest.script
  const editScope = isOutdated
    ? getScriptTranscriptStateByPlanner(plannerState)(block.id)
    : plannerState
  const editContext = useMemo<ScriptTranscriptEditContext>(
    () => ({
      audioSource: isOutdated
        ? block.audioSource
        : (latestScript?.audioSource ?? block.audioSource),
      audioUrl: isOutdated ? block.audioUrl : (latestScript?.audioUrl ?? block.audioUrl),
      editScope,
      plannerState,
      transcriptText: isOutdated ? block.text : (latestScript?.text ?? block.text),
    }),
    [
      block.audioSource,
      block.audioUrl,
      block.text,
      editScope,
      isOutdated,
      latestScript?.audioSource,
      latestScript?.audioUrl,
      latestScript?.text,
      plannerState,
    ],
  )
  const isAudioMode = editContext.audioSource === 'user_audio'
  const isConfirming = useAtomValue(getIsConfirmingScriptReviewGateAtom(plannerState))
  const isActiveTranscriptBlock = canEditScriptTranscript(renderState, block, isAudioMode)
  const canEditTranscript = isActiveTranscriptBlock && !isConfirming
  const openCardHeightClass = 'max-h-[480px]'
  const activeCardHeightClass = 'h-[480px] min-h-[480px]'
  useEffect(() => {
    setIsCollapsed(isOutdated)
  }, [block.id, isOutdated])

  useEffect(() => {
    if (canEditTranscript) {
      return
    }
    editContext.editScope.set(getScriptTranscriptIsFocusedAtom, false)
    editContext.editScope.set(getScriptTranscriptDraftTextAtom, null)
  }, [canEditTranscript, editContext.editScope])

  // The GUI-edit optimistic overrides (draft + saved text) are
  // script_review authoring state. The card's displayed value resolves to
  // `draft ?? savedText ?? blockText`, and savedText is only cleared on a
  // save-failure rollback -- so once the session advances past script_review it
  // keeps masking the agent-driven block text, leaving the refinement transcript
  // card stale (the storyboard updates, the transcript doesn't). Once we're out
  // of script_review the block text is authoritative, so drop the overrides.
  // Gated on phase (not canEditTranscript) so the confirm flow -- which briefly
  // flips canEditTranscript off while still in script_review and relies on
  // savedText for its optimistic display -- is untouched.
  useEffect(() => {
    if (renderState.phase === 'script_review') {
      return
    }
    editContext.editScope.set(getScriptTranscriptDraftTextAtom, null)
    editContext.editScope.set(getScriptTranscriptSavedTextAtom, null)
    editContext.editScope.set(getScriptTranscriptLastSuccessfulSavedTextAtom, null)
  }, [renderState.phase, editContext.editScope])

  // Within script_review the optimistic overrides above also mask a *later* server
  // version. After a manual save, savedText/draft hold the user's text; when the agent then
  // rewrites, editContext.transcriptText (the server's latest script) changes but the stale
  // overrides still win `draft ?? savedText ?? blockText`, so the editor keeps showing the manual
  // edit and hides the agent's rewrite. Reset the overrides once the server has confirmed the
  // saved text (serverText === savedText), after which new server versions render through.
  const savedTextForReset = useAtomValue(getScriptTranscriptSavedTextAtom(editContext.editScope))
  const draftForReset = useAtomValue(getScriptTranscriptDraftTextAtom(editContext.editScope))
  useResetScriptOverridesOnServerChange(
    editContext.editScope,
    editContext.transcriptText,
    savedTextForReset,
    draftForReset,
  )

  const toggleOutdated = () => setIsCollapsed((value) => !value)
  const statusText = (
    <TranscriptStatusText
      hideIdleHint={transcriptOnly}
      hideTransientSaveFeedback={embedded && transcriptOnly}
      isActiveTranscriptBlock={isActiveTranscriptBlock}
      isAudioMode={isAudioMode}
      plannerState={plannerState}
    />
  )

  return (
    <article
      className={transcriptCardClassName({
        activeCardHeightClass,
        canEditTranscript,
        embedded,
        isOutdated,
        isOutdatedCollapsed,
        openCardHeightClass,
        transcriptOnly,
      })}
    >
      {isOutdatedCollapsed ? (
        <OutdatedCollapsedHeader
          isCollapsed={isCollapsed}
          label="Transcript"
          onToggle={toggleOutdated}
        />
      ) : (
        <>
          {showHeader ? (
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 flex-col">
                <h3
                  className="text-[18px] leading-[21.8px] font-semibold text-[#FAFAFA]"
                  style={FONT_FEATURE_SETTINGS}
                >
                  Transcript
                </h3>
                {statusText}
              </div>
              <ScriptTranscriptHeaderActions
                block={block}
                isCollapsed={isCollapsed}
                isOutdated={isOutdated}
                onToggleOutdated={toggleOutdated}
              />
            </div>
          ) : (
            statusText
          )}

          <ScriptTranscriptEditorContent
            block={block}
            displayOnly={transcriptOnly && !embedded}
            editContext={editContext}
            embedded={embedded}
            fillsHost={embedded && transcriptOnly}
            isCollapsed={isCollapsed}
          />
        </>
      )}
    </article>
  )
}

function formatEstimatedDurationLabel(seconds: null | number): string {
  if (!Number.isFinite(seconds)) {
    return '--:--'
  }
  const normalizedSeconds = Math.max(0, Math.round(seconds ?? 0))
  return `${Math.floor(normalizedSeconds / 60)}:${String(normalizedSeconds % 60).padStart(2, '0')}`
}

function ScriptTranscriptDuration({
  editContext,
  wordCount,
}: {
  editContext: ScriptTranscriptEditContext
  wordCount: number
}) {
  const hasVoiceoverAudio = useAtomValue(getCanvasVoiceoverHasAudioAtom(editContext.plannerState))
  // Once a real voiceover exists it shows its actual duration, so the word-count estimate here is
  // redundant and can contradict it. Uploaded audio (user_audio) already renders the
  // real measured duration below -- keep it, only hide the estimate.
  const isAudioMode = editContext.audioSource === 'user_audio'
  if (hasVoiceoverAudio && !isAudioMode) {
    return null
  }

  return (
    <p className="text-sm leading-[17px] font-medium text-white/50" style={FONT_FEATURE_SETTINGS}>
      Est. duration:{' '}
      <ScriptTranscriptDurationLabel editContext={editContext} wordCount={wordCount} />
    </p>
  )
}

function ScriptTranscriptDurationLabel({
  editContext,
  wordCount,
}: {
  editContext: ScriptTranscriptEditContext
  wordCount: number
}) {
  const isAudioMode = editContext.audioSource === 'user_audio'

  const audioMetadataData = useFetcherData(
    useMemo(() => {
      if (!isAudioMode || !editContext.audioUrl) {
        return null
      }
      return getAudioMetadataCacheByPlanner(editContext.plannerState).fetch(editContext.audioUrl)
    }, [editContext.audioUrl, editContext.plannerState, isAudioMode]),
  )
  const audioDurationSeconds =
    audioMetadataData?.state === 'resolved' && audioMetadataData.value.metadata
      ? Math.max(0, Math.round(audioMetadataData.value.metadata.duration ?? 0))
      : null

  const [, textDurationSeconds] = estimateDuration(wordCount)

  const estimatedDurationLabel = formatEstimatedDurationLabel(
    isAudioMode ? audioDurationSeconds : textDurationSeconds,
  )

  return <>{estimatedDurationLabel}</>
}

function ScriptTranscriptEditorContent({
  block,
  displayOnly,
  embedded,
  editContext,
  fillsHost,
  isCollapsed,
}: ScriptTranscriptEditorContentProps) {
  const renderState = useAtomValue(getRenderStateAtom(editContext.plannerState))
  const [isFocused, setIsFocused] = useAtom(getScriptTranscriptIsFocusedAtom(editContext.editScope))

  const isAudioMode = editContext.audioSource === 'user_audio'
  const draftText = useAtomValue(
    getScriptTranscriptDraftTextByBlockTextAtom(editContext.editScope)(editContext.transcriptText),
  )
  const isConfirming = useAtomValue(getIsConfirmingScriptReviewGateAtom(editContext.plannerState))
  const canEditTranscript = canEditScriptTranscript(renderState, block, isAudioMode)
  const storyModeUserLimits = useStoryModeUserLimits()
  const maxWords = storyModeUserLimits.absoluteMaxScriptWords
  const wordCount = countWords(draftText)

  useEffect(() => {
    if (canEditTranscript || !isFocused) {
      return
    }
    void syncTranscriptEditingActive(editContext.plannerState, false)
  }, [canEditTranscript, editContext.plannerState, isFocused])

  if (isCollapsed) {
    return null
  }

  const beginEditing = () => {
    if (!canEditTranscript || isConfirming) {
      return
    }
    setIsFocused(true)
    editContext.editScope.set(getScriptTranscriptDraftTextAtom, draftText)
  }

  const restoreFromBlur = () => {
    setIsFocused(false)
    if (canEditTranscript) {
      void syncTranscriptEditingActive(editContext.plannerState, false)
      // A blank draft is deliberately let through to saveScriptTranscriptEdits: its guard
      // rejects the save, keeps the draft, and raises the "Script cannot be empty." toast.
      // Skipping the call here instead would blank the transcript with no feedback, and the
      // edit modal's unmount then reverts the text -- reading as a lost edit.
      if (wordCount <= maxWords) {
        void saveScriptTranscriptEdits({
          blockText: editContext.transcriptText,
          plannerState: editContext.plannerState,
          scriptTranscriptState: editContext.editScope,
        })
      }
    }
  }

  // Audio-mode transcripts have no word budget to spend against (the audio's own length is the
  // constraint), so the readout drops the "/ N words" limit there.
  const wordCountProps: ScriptWordCount = isAudioMode
    ? { value: wordCount }
    : { max: maxWords, value: wordCount }

  const isEditing = canEditTranscript && !isConfirming && !displayOnly
  return (
    <ScriptContent
      editable={
        isEditing
          ? {
              autoFocus: isFocused,
              // Embedded (Edit modal): flat -- no box, so the modal is one flat surface. Otherwise
              // (legacy timeline) keep the bordered textarea affordance.
              boxed: !embedded,
              // Only a host stretched to the modal body can stop the growth; a content-sized or
              // max-height host would let it run past the surface.
              growWithContent: fillsHost,
              onBlur: restoreFromBlur,
              onChange: (nextText: string) => {
                editContext.editScope.set(getScriptTranscriptDraftTextAtom, nextText)
              },
              onFocus: () => {
                if (!isFocused) {
                  beginEditing()
                  void syncTranscriptEditingActive(editContext.plannerState, true)
                }
              },
            }
          : undefined
      }
      footer={<ScriptTranscriptDuration editContext={editContext} wordCount={wordCount} />}
      testId={
        isEditing && isFocused ? 'uip-script-transcript-textarea' : 'uip-script-transcript-readonly'
      }
      text={draftText}
      wordCount={wordCountProps}
    />
  )
}

function ScriptTranscriptHeaderActions({
  block,
  isCollapsed,
  isOutdated,
  onToggleOutdated,
}: ScriptTranscriptHeaderActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {block.blockStatus === 'updated' ? <UpdatedStatusBadge /> : null}
      {isOutdated ? (
        <OutdatedCollapseToggle isCollapsed={isCollapsed} onToggle={onToggleOutdated} />
      ) : null}
    </div>
  )
}

// Resolves the transcript card's outer className across its variants: legacy timeline (boxed),
// canvas Script section (transcriptOnly -> flat, natural height), and the Edit modal (embedded
// -> flat, fills the modal body). Extracted so the component stays under the cognitive-complexity
// limit.
function transcriptCardClassName(params: {
  activeCardHeightClass: string
  canEditTranscript: boolean
  embedded: boolean
  isOutdated: boolean
  isOutdatedCollapsed: boolean
  openCardHeightClass: string
  transcriptOnly: boolean
}): string {
  if (params.isOutdatedCollapsed) {
    return 'w-full overflow-hidden rounded-2xl border border-white/10 p-6'
  }
  if (params.embedded) {
    // Chromeless: the Edit Script modal is the container, so drop the card's
    // border/background/rounded/padding/fixed-height and just fill the modal body.
    return 'flex w-full min-h-0 flex-1 flex-col gap-4'
  }
  if (params.transcriptOnly) {
    // Canvas Script section: flat against the panel background (no card box or fixed
    // height), matching the Edit modal.
    return 'flex w-full flex-col gap-4'
  }
  return cn(
    'uip-transcript-card-mobile flex w-full flex-col gap-4 overflow-hidden rounded-2xl p-6 transition-[min-height] duration-500 ease-in-out-soft',
    params.openCardHeightClass,
    params.isOutdated
      ? 'border border-white/10'
      : 'border border-transparent bg-[rgba(255,255,255,0.05)]',
    params.canEditTranscript ? params.activeCardHeightClass : 'min-h-0',
  )
}

function TranscriptStatusText({
  hideIdleHint,
  hideTransientSaveFeedback,
  isActiveTranscriptBlock,
  isAudioMode,
  plannerState,
}: TranscriptStatusTextProps) {
  const display = useTranscriptSaveDisplay(plannerState)

  let content: ReactNode = null
  if (isActiveTranscriptBlock) {
    if (display === 'saving' && !hideTransientSaveFeedback) {
      content = 'Saving...'
    } else if (display === 'saved' && !hideTransientSaveFeedback) {
      content = 'Saved!'
    } else if (display === 'failed') {
      content = (
        <>
          Failed to save{' '}
          <button
            className="underline"
            onClick={() => retryScriptTranscriptSave(plannerState)}
            type="button"
          >
            Retry
          </button>
        </>
      )
    } else if (display === 'idle' && !hideIdleHint) {
      content = 'Review your transcript, edit directly or ask agent to edit'
    }
  } else if (isAudioMode) {
    content = 'Audio to video transcripts are not modifiable.'
  }

  // Render nothing (not an empty <p>) when there is no message, so the flex-gap above the
  // editor collapses -- the revamp surfaces suppress the idle hint via hideIdleHint.
  if (content === null) {
    return null
  }

  return (
    <p className="text-sm leading-[22px] font-normal text-white/50" style={FONT_FEATURE_SETTINGS}>
      {content}
    </p>
  )
}
