'use client'

import { Button, cn, toast, Tooltip } from '@shared/ui'
import { useSetAtom } from 'jotai'
import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { longtakeHistoryStore } from '@/atom/longtake-history.store'
import type { KeyframeFrameRole } from '@/atom/longtake-history.types'
import RiveCanvas from '@/components/animated/RiveCanvas'
import { ArrowUp, ChevronDownSmall } from '@/components/icons/core'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useApi } from '@/hooks/useApi'
import { getPublicCdnUrl } from '@/util/cdn-utils'

const EditorSMKeyframeDialog = dynamic(
  () =>
    import('../EditDialog/EditorSMKeyframeDialog').then((m) => ({
      default: m.EditorSMKeyframeDialog,
    })),
  { ssr: false },
)

import { DEFAULT_PROMPT, PRESET_PROMPTS } from '../constants'
import type {
  RegenerateTransitionCallbacks,
  RegenerateTransitionOptions,
} from '../hooks/useOwnerEditActions'
import { hasUnfilledPlaceholder } from '../prompt-placeholder.util'

import FramePreview from './FramePreview'
import EditBoxPromptField from './PromptTextarea'

interface EditSurfaceProps {
  children: React.ReactNode
  isEditing: boolean
}

type LipSyncPreviewControl = {
  enabled: boolean
  transitionId: string
}

interface ShotHeaderRowProps {
  displayLabel: string
  onCollapse: () => void
}

const EditSurface: React.FC<EditSurfaceProps> = ({ children, isEditing }) => {
  return (
    <div
      className={cn(
        'relative flex flex-col overflow-visible transition-[background-color,padding] duration-500 ease-in-out-soft',
        isEditing
          ? 'rounded-[24px] border border-white/5 bg-secondary px-2 pt-1.5 pb-2 backdrop-blur-2xl'
          : 'h-12 cursor-text rounded-[24px] bg-fill-secondary px-1.5 py-0 backdrop-blur-2xl',
      )}
      data-onboarding-target="editor-edit-box"
    >
      {children}
    </div>
  )
}

interface PresetPromptBarProps {
  onPick: (value: string, label: string) => void
}

const PresetPromptBar: React.FC<PresetPromptBarProps> = ({ onPick }) => {
  return (
    <>
      {PRESET_PROMPTS.map((presetPrompt) => (
        <Button
          className="h-8 w-auto shrink-0 whitespace-nowrap px-2 py-1 text-xs hover:bg-transparent hover:text-foreground active:bg-transparent active:text-foreground"
          key={presetPrompt.label}
          onClick={() => onPick(presetPrompt.value, presetPrompt.label)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {presetPrompt.label}
        </Button>
      ))}
    </>
  )
}

const RegeneratingOverlay: React.FC = () => {
  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl">
      <div className="absolute inset-0 backdrop-blur-sm" />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/58 to-black/60"
      />
      <div className="relative flex items-center gap-2">
        <RiveCanvas
          autoplay
          className="size-4.5"
          showLoadingSkeleton={false}
          src={getPublicCdnUrl('agent/rive/ai_icon_primary.riv')}
          stateMachines="State Machine"
        />
        <span className="text-left text-sm font-medium text-primary shine-text">
          Working on generating new shots...
        </span>
      </div>
    </div>
  )
}

const ShotHeaderRow: React.FC<ShotHeaderRowProps> = ({ displayLabel, onCollapse }) => {
  return (
    <div className="flex flex-shrink-0 items-center justify-between px-2 py-1">
      <span className="text-xs font-medium uppercase text-secondary">{displayLabel}</span>
      <div className="flex shrink-0 items-center gap-3">
        <Button
          className="flex size-5 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-secondary transition-colors hover:bg-fill-hover hover:text-primary"
          onClick={onCollapse}
          variant="base"
        >
          <ChevronDownSmall className="size-3.5 shrink-0" />
        </Button>
      </div>
    </div>
  )
}

const LipSyncPreviewButton: React.FC<{
  disabled: boolean
  lipSyncPreview: LipSyncPreviewControl
  onLipSyncPreviewChange?: (transitionId: string, enabled: boolean) => void
}> = ({ disabled, lipSyncPreview, onLipSyncPreviewChange }) => {
  const nextEnabled = !lipSyncPreview.enabled
  return (
    <Tooltip
      className="bg-overlay rounded-xs text-primary backdrop-blur-xl px-2 py-1"
      content={lipSyncPreview.enabled ? 'Preview with lip sync' : 'Preview without lip sync'}
      side="top"
      sideOffset={8}
    >
      <Button
        aria-pressed={lipSyncPreview.enabled}
        className={cn(
          'h-8 w-auto shrink-0 whitespace-nowrap px-2 py-1 text-xs transition-colors',
          lipSyncPreview.enabled
            ? 'bg-white/12 text-foreground hover:bg-white/16'
            : 'text-secondary hover:bg-transparent hover:text-foreground',
        )}
        disabled={disabled}
        onClick={() => onLipSyncPreviewChange?.(lipSyncPreview.transitionId, nextEnabled)}
        size="sm"
        type="button"
        variant="ghost"
      >
        {lipSyncPreview.enabled ? 'Lip sync on' : 'Lip sync off'}
      </Button>
    </Tooltip>
  )
}

interface EditBoxProps {
  displayLabel: string
  endFrameUrl: string
  endKeyframeId: string
  endShotLabel: string
  endThumbnailUrl?: string
  isEditing: boolean
  isRegenerating: boolean
  keyframeIndex: number
  lipSyncPreview?: LipSyncPreviewControl | null
  onEditingChange: (editing: boolean) => void
  onLipSyncPreviewChange?: (transitionId: string, enabled: boolean) => void
  onRegenerate: (
    prompt: string,
    callbacks?: RegenerateTransitionCallbacks,
    options?: RegenerateTransitionOptions,
  ) => void
  onUserInteraction?: () => void
  projectId: string
  startFrameUrl: string
  startKeyframeId: string
  startShotLabel: string
  startThumbnailUrl?: string
  transitionId: null | string
}

type KeyframeDialogState = null | {
  frameRole: KeyframeFrameRole
  imageUrl: string
  initialPrompt: string
  keyframeId: string
  transitionId: string
}

const EditBox: React.FC<EditBoxProps> = ({
  isEditing,
  onEditingChange,
  startFrameUrl,
  endFrameUrl,
  startKeyframeId,
  endKeyframeId,
  endShotLabel,
  endThumbnailUrl,
  keyframeIndex,
  lipSyncPreview,
  displayLabel,
  isRegenerating,
  onRegenerate,
  onUserInteraction,
  onLipSyncPreviewChange,
  projectId,
  startShotLabel,
  startThumbnailUrl,
  transitionId,
}) => {
  const [dialogState, setDialogState] = useState<KeyframeDialogState>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const dialogEverOpenedRef = useRef(false)
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({})
  const [showSubmitHint, setShowSubmitHint] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { fetchApiDomain } = useApi()
  const applyRegeneratedKeyframe = useSetAtom(longtakeHistoryStore.applyRegeneratedKeyframeAtom)
  const prompt = transitionId ? (promptDrafts[transitionId] ?? '') : ''

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      let timerId = 0
      const frameId = window.requestAnimationFrame(() => {
        timerId = window.setTimeout(() => inputRef.current?.focus(), 500)
      })
      return () => {
        window.cancelAnimationFrame(frameId)
        if (timerId) {
          clearTimeout(timerId)
        }
      }
    }
  }, [isEditing])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isEditing) {
        onEditingChange(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isEditing, onEditingChange])

  const handleRegenerate = useRefCallback(
    (
      nextPrompt: string,
      callbacks?: RegenerateTransitionCallbacks,
      options?: RegenerateTransitionOptions,
    ) => {
      onRegenerate(nextPrompt, callbacks, options)
    },
  )

  const clearPromptDraft = useRefCallback((submittedTransitionId: null | string | undefined) => {
    if (!submittedTransitionId) {
      return
    }

    setPromptDrafts((prev) => {
      if ((prev[submittedTransitionId] ?? '') === '') {
        return prev
      }

      return {
        ...prev,
        [submittedTransitionId]: '',
      }
    })
  })

  const setPromptDraft = useRefCallback(
    (submittedTransitionId: null | string | undefined, nextPrompt: string) => {
      if (!submittedTransitionId) {
        return
      }

      setPromptDrafts((prev) => {
        if ((prev[submittedTransitionId] ?? '') === nextPrompt) {
          return prev
        }

        return {
          ...prev,
          [submittedTransitionId]: nextPrompt,
        }
      })
    },
  )

  const handleKeyframeConfirm = useRefCallback(
    (nextImageUrl: string, nextThumbnailUrl?: string) => {
      if (!dialogState) {
        return
      }
      const submittedTransitionId = dialogState.transitionId
      setDialogState((prev) => (prev ? { ...prev, imageUrl: nextImageUrl } : prev))
      const applied = applyRegeneratedKeyframe({
        frameRole: dialogState.frameRole,
        keyframeUrl: nextImageUrl,
        thumbnailUrl: nextThumbnailUrl,
        transitionId: submittedTransitionId,
      })
      if (!applied) {
        toast.error("Couldn't apply the regenerated shot. Refresh and try again.")
        return
      }
      setShowSubmitHint(false)
      handleRegenerate(
        DEFAULT_PROMPT,
        {
          onFailure: () => {
            setPromptDraft(submittedTransitionId, DEFAULT_PROMPT)
          },
          onSuccess: () => {
            clearPromptDraft(submittedTransitionId)
          },
        },
        { keyframeDriven: true, targetTransitionId: submittedTransitionId },
      )
    },
  )

  const handleKeyframeCancel = useRefCallback(async (workflowId: string) => {
    if (!workflowId) {
      return
    }
    try {
      await fetchApiDomain(`/api/long-take-videos/${projectId}/cancel`, {
        method: 'POST',
        data: { workflowId },
      })
      toast.success('Keyframe generation cancelled')
    } catch {
      toast.error('Failed to cancel keyframe generation')
    }
  })

  // Stable refs: FramePreview re-runs renderSlots when these identities change; inline fns caused DOM to be rebuilt every StorySequencer frame while playing, eating the first click.
  const handleSelectStart = useCallback(() => {
    if (!transitionId) {
      return
    }
    dialogEverOpenedRef.current = true
    setDialogState({
      frameRole: 'firstFrame',
      imageUrl: startFrameUrl,
      initialPrompt: '',
      keyframeId: startKeyframeId,
      transitionId,
    })
    setDialogOpen(true)
  }, [startFrameUrl, startKeyframeId, transitionId])

  const handleSelectEnd = useCallback(() => {
    if (!transitionId) {
      return
    }
    dialogEverOpenedRef.current = true
    setDialogState({
      frameRole: 'lastFrame',
      imageUrl: endFrameUrl,
      initialPrompt: '',
      keyframeId: endKeyframeId,
      transitionId,
    })
    setDialogOpen(true)
  }, [endFrameUrl, endKeyframeId, transitionId])

  const handleDialogOpenChange = useRefCallback((open: boolean) => {
    setDialogOpen(open)
  })

  const maybePauseOnUserInteraction = useRefCallback(() => {
    if (isRegenerating) {
      return
    }
    onUserInteraction?.()
  })

  const submitTransitionPrompt = useRefCallback(() => {
    const submittedTransitionId = transitionId
    setShowSubmitHint(false)
    handleRegenerate(prompt, {
      onSuccess: () => {
        clearPromptDraft(submittedTransitionId)
      },
    })
  })

  const handlePrimaryAction = useRefCallback(() => {
    if (!isEditing) {
      onEditingChange(true)
      return
    }
    if (!prompt || isRegenerating || hasUnfilledPlaceholder(prompt)) {
      return
    }
    submitTransitionPrompt()
  })

  const handleInputFocus = useRefCallback(() => {
    if (!isEditing) {
      onEditingChange(true)
    }
  })

  const handlePresetPick = useRefCallback((value: string, label: string) => {
    handlePromptChange(value)
  })

  const handlePromptChange = useRefCallback((nextPrompt: string) => {
    if (!transitionId) {
      return
    }

    setPromptDrafts((prev) => ({ ...prev, [transitionId]: nextPrompt }))
  })

  const promptHasUnfilledPlaceholder = hasUnfilledPlaceholder(prompt)
  const transitionSubmitDisabled = isRegenerating || !prompt || promptHasUnfilledPlaceholder

  const renderTooltipContent = () => {
    if (isRegenerating) {
      return null
    }
    if (!prompt) {
      return 'Enter a prompt to submit'
    }
    if (promptHasUnfilledPlaceholder) {
      return 'Replace [ ] with what you want to change'
    }
    return 'Submit transition changes'
  }

  return (
    <div
      className={cn(
        'relative w-full max-w-3xl flex-shrink-0 overflow-hidden transition-[max-height] duration-500 ease-in-out-soft',
        isEditing ? 'max-h-52' : 'max-h-12',
      )}
      onFocusCapture={maybePauseOnUserInteraction}
      onPointerDownCapture={maybePauseOnUserInteraction}
    >
      <div
        className={cn('relative flex flex-col overflow-visible', !isEditing && 'h-full')}
        onClick={isEditing ? undefined : () => onEditingChange(true)}
      >
        <div className={cn('relative flex min-h-0 flex-col', !isEditing && 'min-h-0 flex-1')}>
          {isRegenerating && <RegeneratingOverlay />}
          <div
            className={cn(
              'overflow-hidden transition-[height,opacity,margin-bottom] duration-500 ease-in-out-soft',
              isEditing
                ? 'pointer-events-auto mb-1.5 h-7 opacity-100'
                : 'pointer-events-none mb-0 h-0 opacity-0',
            )}
          >
            <ShotHeaderRow displayLabel={displayLabel} onCollapse={() => onEditingChange(false)} />
          </div>

          <EditSurface isEditing={isEditing}>
            <div
              className={cn(
                'transition-[height,opacity,margin-bottom] duration-500 ease-in-out-soft',
                isEditing
                  ? 'pointer-events-auto mb-1.5 h-12 overflow-visible opacity-100'
                  : 'pointer-events-none mb-0 h-0 overflow-hidden opacity-0',
              )}
              data-onboarding-target="editor-frame-preview"
            >
              <FramePreview
                activeKeyframeIndex={keyframeIndex}
                endShotLabel={endShotLabel}
                endUrl={endThumbnailUrl || endFrameUrl}
                onSelectEnd={handleSelectEnd}
                onSelectStart={handleSelectStart}
                startShotLabel={startShotLabel}
                startUrl={startThumbnailUrl || startFrameUrl}
              />
            </div>

            <div className="flex min-h-12 flex-shrink-0 flex-col items-stretch gap-0">
              <EditBoxPromptField
                handleInputFocus={handleInputFocus}
                handlePrimaryAction={handlePrimaryAction}
                handlePromptChange={handlePromptChange}
                inputRef={inputRef}
                isEditing={isEditing}
                prompt={prompt}
              />
              <div
                className={cn(
                  'overflow-hidden transition-[height,opacity,margin-top] duration-500 ease-in-out-soft',
                  isEditing
                    ? 'pointer-events-auto mt-2 h-9 w-full opacity-100'
                    : 'pointer-events-none mt-0 h-0 w-full opacity-0',
                )}
              >
                <div
                  className="flex h-9 w-full items-center justify-between gap-2"
                  data-onboarding-target="editor-preset-prompts"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scrollbar-none">
                    <PresetPromptBar onPick={handlePresetPick} />
                    {lipSyncPreview && (
                      <LipSyncPreviewButton
                        disabled={isRegenerating}
                        lipSyncPreview={lipSyncPreview}
                        onLipSyncPreviewChange={onLipSyncPreviewChange}
                      />
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Tooltip
                      className="bg-overlay rounded-xs text-primary backdrop-blur-xl"
                      content={renderTooltipContent()}
                      onOpenChange={(open) => {
                        if (!open && dialogOpen) {
                          return
                        }
                        setShowSubmitHint(open)
                      }}
                      open={showSubmitHint}
                      portal
                      side="top"
                    >
                      <div>
                        <Button
                          className={cn(
                            'shrink-0 rounded-full transition-colors',
                            transitionSubmitDisabled
                              ? 'bg-secondary text-primary'
                              : 'bg-fill text-primary-foreground',
                          )}
                          disabled={transitionSubmitDisabled}
                          onClick={handlePrimaryAction}
                          size="icon"
                          type="button"
                        >
                          <ArrowUp className="size-3.5" />
                        </Button>
                      </div>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </div>
          </EditSurface>
        </div>
      </div>

      {dialogEverOpenedRef.current && (
        <EditorSMKeyframeDialog
          frameRole={dialogState?.frameRole ?? 'firstFrame'}
          imageUrl={dialogState?.imageUrl ?? endFrameUrl}
          initialPrompt={dialogState?.initialPrompt ?? ''}
          keyframeId={dialogState?.keyframeId ?? endKeyframeId}
          onCancel={handleKeyframeCancel}
          onKeyframeConfirm={handleKeyframeConfirm}
          onOpenChange={handleDialogOpenChange}
          open={dialogOpen}
          projectId={projectId}
          transitionId={dialogState?.transitionId ?? ''}
        />
      )}
    </div>
  )
}

export default memo(EditBox)
