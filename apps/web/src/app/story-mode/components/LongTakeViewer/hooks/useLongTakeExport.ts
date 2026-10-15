import type {
  LongTakeEditorState,
  LongTakeRenderRequest,
  LongTakeRenderSettings,
  UpscaleOutcome,
} from '@shared/types/api/long-take'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import { toast } from '@shared/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom, useStore } from 'jotai'

import {
  commitRenderSettingsBaselineAtom,
  longtakeHistoryStore,
  renderSettingsAtom,
} from '@/atom/longtake-history.store'
import { captionStatusQueryKey } from '@/components/captions/useCaptionSettings'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { videoScriptQueryKey } from '@/hooks/useVideoScript'

import {
  applyLipSyncPreviewOverridesToTransitions,
  hasLipSyncPreviewExportChanges,
} from '../StorySequencer/engine'

import { useLongTakeExportRunner } from './useLongTakeExportRunner'
import { useInvalidateUnrenderedChanges } from './useUnrenderedChanges'

export interface StartExportOptions {
  forceRender?: boolean
}

export interface UseLongTakeExportOptions {
  // Whether the delivered video has background music; sent with export renders.
  bgmEnabled?: boolean | null
  isBrandVideo?: boolean
  lipSyncDownloadEnabled?: boolean
  lipSyncPreviewOverrides?: Record<string, boolean>
  onComplete?: () => void
  onStop?: () => void
  projectId: string
  /** Applied style identity, threaded to sm_editor.export.* tracking. */
  styleName?: string
  tier?: ModelSelectorAnalyticsTier
  transitionVideoModel?: string
  upscaleOutcome?: UpscaleOutcome
}

// Legacy long-take editor adapter: sources the export inputs from the editor history
// atoms and commits the post-render baseline back into them. All export mechanics live in
// useLongTakeExportRunner, shared with the inpaint editor.
export function useLongTakeExport({
  bgmEnabled,
  isBrandVideo,
  upscaleOutcome,
  lipSyncDownloadEnabled,
  lipSyncPreviewOverrides,
  onComplete,
  onStop,
  projectId,
  styleName,
  tier,
  transitionVideoModel,
}: UseLongTakeExportOptions) {
  // The export inputs are read from the store when the export starts, not from this
  // render: a caller may have just loaded the project or set its caption setting (the
  // agent page does, right before exporting).
  const store = useStore()
  const queryClient = useQueryClient()
  const regeneratingTransitionIds = useAtomValue(longtakeHistoryStore.regeneratingTransitionIdsAtom)
  const commitRenderBaseline = useSetAtom(longtakeHistoryStore.commitRenderBaselineAtom)
  const commitRenderSettingsBaseline = useSetAtom(commitRenderSettingsBaselineAtom)
  const setBgmRenderRequired = useSetAtom(longtakeHistoryStore.setBgmRenderRequiredAtom)
  const invalidateUnrenderedChanges = useInvalidateUnrenderedChanges(projectId)

  const runner = useLongTakeExportRunner({
    isBrandVideo,
    upscaleOutcome,
    onComplete,
    onRenderComplete: (submitted) => {
      // The history store holds one project: commit only into this one's. Another page
      // part (the agent page's other videos) may have loaded a different project since.
      if (store.get(longtakeHistoryStore.editedProjectIdAtom) === projectId) {
        commitRenderBaseline(submitted)
        commitRenderSettingsBaseline({ projectId, submitted: submitted.settings })
      } else {
        setBgmRenderRequired({ projectId, required: false })
      }
      invalidateUnrenderedChanges()
      // The status now names the look the new file has.
      void queryClient.invalidateQueries({ queryKey: captionStatusQueryKey(projectId) })
      // And the video script is the one the render saved: the previews draw a loop's fact
      // stamps from it only, so an older loop's first render since gives them stamps.
      void queryClient.invalidateQueries({ queryKey: videoScriptQueryKey(projectId) })
    },
    onStop,
    projectId,
    styleName,
    tier,
    transitionVideoModel,
    lipSyncDownloadEnabled,
  })

  const notifyStaleTransitions = useRefCallback(
    (currentState: LongTakeEditorState | null, staleTransitionIds: ReadonlySet<string>) => {
      const shotIndexById = new Map(
        (currentState?.keyframes ?? []).map((kf, idx) => [kf.shotId, idx + 1]),
      )
      const staleLabels = (currentState?.transitions ?? [])
        .filter((t) => staleTransitionIds.has(t.transitionId))
        .map((t) => {
          const from = shotIndexById.get(t.fromShotId)
          const to = shotIndexById.get(t.toShotId)
          return from && to ? `Shot ${from} → ${to}` : null
        })
        .filter((label): label is string => label !== null)

      if (staleLabels.length === 0) {
        toast.warning(
          'Some transitions still use the previous version. Regenerate to apply your latest edits.',
        )
        return
      }

      const verb = staleLabels.length === 1 ? 'uses' : 'use'
      toast.warning(
        `${staleLabels.join(', ')} still ${verb} the previous transition. Regenerate to apply your edit.`,
      )
    },
  )

  // `forceRender`: render even though the editor sees nothing to render, e.g. because the
  // delivered file is gone (the agent page checks that before exporting).
  const startExport = useRefCallback((isWithWatermark: boolean, options?: StartExportOptions) => {
    const currentState = store.get(longtakeHistoryStore.currentStateAtom)
    const baseState = store.get(longtakeHistoryStore.baseStateAtom)
    const baseRevision = store.get(longtakeHistoryStore.baseRevisionAtom)
    const renderSettings = store.get(renderSettingsAtom)
    const staleTransitionIds = store.get(longtakeHistoryStore.staleTransitionIdsAtom)
    const regenerating = store.get(longtakeHistoryStore.regeneratingTransitionIdsAtom)
    const exportTransitions = applyLipSyncPreviewOverridesToTransitions(
      currentState?.transitions ?? [],
      lipSyncPreviewOverrides,
    )
    const effectiveRenderRequired =
      store.get(longtakeHistoryStore.renderRequiredAtom) ||
      hasLipSyncPreviewExportChanges(baseState?.transitions ?? [], exportTransitions)
    const settings: LongTakeRenderSettings = {
      captionEnabled: renderSettings.captionEnabled.latest,
      // The caption look the user is looking at; unknown, the render reads the saved one.
      ...(renderSettings.captionStyle.known
        ? { captionStyle: renderSettings.captionStyle.latest }
        : {}),
      ...(bgmEnabled == null ? {} : { bgmEnabled }),
    }
    const request: LongTakeRenderRequest = {
      expectedRevision: baseRevision,
      keyframes: currentState?.keyframes ?? [],
      settings,
      // Submit the lip-sync-override-applied transitions, matching what
      // effectiveRenderRequired is computed from.
      transitions: exportTransitions,
    }
    return runner.startExport(isWithWatermark, {
      preRenderGuard: () => {
        if (regenerating.size > 0) {
          toast.warning('Wait for transition regeneration to finish before exporting.')
          return false
        }
        if (staleTransitionIds.size > 0) {
          notifyStaleTransitions(currentState, staleTransitionIds)
        }
        return true
      },
      renderRequired: effectiveRenderRequired || !!options?.forceRender,
      request,
    })
  })

  return {
    isActive: runner.isActive,
    isCompleted: runner.isCompleted,
    isExportDisabled: regeneratingTransitionIds.size > 0,
    isUpscaling: runner.isUpscaling,
    startExport,
    status: runner.status,
  }
}
