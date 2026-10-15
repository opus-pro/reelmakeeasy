'use client'

import { buildLongTakeEditorRevision } from '@reelmakeeasy/common/long-take/editor-state'
import type { LongTakeEditorStateResponse } from '@shared/types/api/long-take'
import type { DebugSettings } from '@shared/types/project/debug-settings'
import { toast } from '@shared/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useId, useRef } from 'react'

import { useLongTakeDownload } from '@/app/story-mode/components/LongTakeViewer/LongTakeDownload'
import { longtakeHistoryStore, renderSettingsAtom } from '@/atom/longtake-history.store'
import { getCaptionStatus } from '@/components/captions/caption-settings.api'
import {
  captionStyleRenderSetting,
  shownCaptionStyle,
} from '@/components/captions/useCaptionSettings'
import { useApi } from '@/hooks/useApi'

import { agentDownloadLockAtom } from './exclusivePlayback'
import { renderedFileExists } from './renderedFile'
import { useAgentCaptionChoice } from './useAgentCaptionChoice'
import { useAgentProject } from './useAgentProject'
import type { ProjectProgress } from './useProjectProgress'

/**
 * Download is the editor's own (`useLongTakeDownload` and `LongTakeExportProgressDialog`,
 * as the editor's Download button uses them): when there is something to render it renders
 * first, with the editor's progress dialog, then downloads; otherwise it downloads the
 * delivered file. Before it runs, the editor's project state is loaded for this project
 * (the history store holds one project, and a page using this hook can show several) and
 * its caption settings are set from the switch and the caption look (the delivered file's
 * against the one chosen), so the editor's own decision applies. It also renders when the
 * delivered file is gone or the server reports unrendered changes, which the editor's
 * state can't see.
 */
export function useAgentVideoDownload({
  progress,
  projectId,
}: {
  progress: ProjectProgress
  projectId: string
}) {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()
  const { bgmEnabled, captionsInVideo, noteRendered, videoUrl } = progress
  const { captionsOn, setCaptionsOn } = useAgentCaptionChoice(projectId, captionsInVideo)
  const project = useAgentProject(projectId)
  const debugSettings = project?.debugSettings as DebugSettings | undefined

  // The captions the export renders with, for when it completes.
  const exportCaptionsRef = useRef(true)
  const download = useLongTakeDownload({
    bgmEnabled,
    onComplete: () => noteRendered(exportCaptionsRef.current),
    projectId,
    tier: project?.modelSelectorTier ?? undefined,
    transitionVideoModel: debugSettings?.transitionVideoModel,
  })
  const { isActive, startExport } = download

  // One agent Download prepares or starts at a time on the page: the editor state it
  // loads holds one project.
  const store = useStore()
  const lockId = useId()
  const downloadLock = useAtomValue(agentDownloadLockAtom)
  const initializeHistory = useSetAtom(longtakeHistoryStore.initializeHistoryAtom)

  const handleDownload = async () => {
    if (store.get(agentDownloadLockAtom) !== null) return
    store.set(agentDownloadLockAtom, lockId)
    try {
      const captions = captionsOn ?? captionsInVideo ?? true
      const [fileMissing, response, captionStatus] = await Promise.all([
        videoUrl ? renderedFileExists(videoUrl).then((exists) => !exists) : false,
        fetchApiDomain<LongTakeEditorStateResponse>(`/api/long-take-videos/${projectId}/state`, {
          method: 'GET',
          noThrowError: true,
        }),
        // The delivered file's look, read past the cache: a save on its way can't drop this
        // read, nor this read put an older look in the previews. Unreadable, the render
        // keeps the saved look and nothing asks for one.
        getCaptionStatus(fetchApiDomain, projectId).catch(() => null),
      ])
      const editor = response.ok ? response.data : null
      if (!editor?.data) {
        throw new Error(response.error || "Couldn't read the video's clips.")
      }
      if (store.get(longtakeHistoryStore.editedProjectIdAtom) !== projectId) {
        await initializeHistory({ currentState: editor.data, fetchApiDomain, projectId })
      }
      // Read fresh after the awaits: a player starting meanwhile loads its own project.
      const base = store.get(longtakeHistoryStore.baseStateAtom)
      if (
        store.get(longtakeHistoryStore.editedProjectIdAtom) !== projectId ||
        !base ||
        buildLongTakeEditorRevision(base) !== store.get(longtakeHistoryStore.baseRevisionAtom)
      ) {
        toast.error('Another video was opened meanwhile. Press Download again.')
        return
      }
      // The editor's caption settings for this project (what the file has, and the switch
      // and the look on screen), set in the same tick the export reads them.
      store.set(longtakeHistoryStore.seedRenderSettingsProjectAtom, projectId)
      store.set(renderSettingsAtom, (prev) => ({
        ...prev,
        captionEnabled: { latest: captions, original: captionsInVideo ?? captions },
        // Against the look the previews draw now.
        captionStyle: captionStatus
          ? captionStyleRenderSetting(
              captionStatus,
              shownCaptionStyle(store, queryClient, projectId),
              project?.longTakeRatio,
            )
          : { ...prev.captionStyle, known: false },
      }))
      exportCaptionsRef.current = captions
      // The export path owns its own error toasts.
      await startExport(false, {
        forceRender: fileMissing || editor.hasUnrenderedChanges,
      }).catch(() => undefined)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Download failed')
    } finally {
      store.set(agentDownloadLockAtom, null)
    }
  }

  const preparing = downloadLock === lockId
  const busy = preparing || isActive

  return {
    busy,
    captionsOn,
    download,
    handleDownload,
    locked: downloadLock !== null,
    project,
    setCaptionsOn,
  }
}
