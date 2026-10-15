'use client'

import { sessionRowMenu } from '@reelmakeeasy/common/codex-agent/agent-sessions'
import type { AgentSessionListItem } from '@shared/types/api/agent'
import { toast } from '@shared/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { LongTakeExportProgressDialog } from '@/app/story-mode/components/LongTakeViewer/LongTakeDownload'
import { deleteProjectDialogAtom } from '@/atom/delete-project-dialog'
import type { ContextMenuItem } from '@/components/ContextMenu'
import { DeleteProjectDialog } from '@/components/delete-project-dialog/DeleteProjectDialog'
import { Delete, DownloadCircle, Edit, Editor } from '@/components/icons/core'
import { DELETE_WHILE_GENERATING_TOOLTIP } from '@/components/projects-v2/ProjectCardMenuItems'
import {
  fetchProjectById,
  getProjectsQueryKeyPrefix,
  renameProject,
} from '@/hooks/projects-query-utils'
import { useApi } from '@/hooks/useApi'
import { hardNavigate } from '@/util/hard-navigation'

import { ProjectProgressProvider } from './ProjectProgressProvider'
import { useRefreshAgentSessions } from './useAgentSessions'
import { useAgentVideoDownload } from './useAgentVideoDownload'
import { useProjectProgress } from './useProjectProgress'

/** `progress.done`/`progress.error` can diverge from the row's own stage forever (the poll
 *  and the row read different state); past this, give up rather than leave every sidebar
 *  Download disabled behind a `downloading` that never clears. */
const DOWNLOAD_PREPARE_TIMEOUT_MS = 20_000

/** Runs one sidebar Download: loads the project's status, then the editor's Download flow
 *  (render first when needed, with the editor's progress dialog). Ends when it is done. */
function DownloadRunner({ onDone, projectId }: { onDone: () => void; projectId: string }) {
  const progress = useProjectProgress(projectId)
  const { busy, captionsOn, download, handleDownload, project } = useAgentVideoDownload({
    progress,
    projectId,
  })
  const started = useRef(false)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    if (started.current) return
    if (progress.error) {
      // Mark handled before the toast/onDone: a persisting error re-runs this effect
      // (`handleDownload` and `progress.error` keep changing identity/value) and this
      // guard is what keeps it from toasting more than once.
      started.current = true
      toast.error(progress.error)
      onDone()
      return
    }
    if (!progress.done || captionsOn === null) return
    started.current = true
    void handleDownload().finally(() => setFinished(true))
  }, [captionsOn, handleDownload, onDone, progress.done, progress.error])

  useEffect(() => {
    if (finished && !busy && !download.dialogOpen) onDone()
  }, [busy, download.dialogOpen, finished, onDone])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Same once-guard as the error branch above: whichever fires first wins.
      if (started.current) return
      started.current = true
      toast.error("Couldn't prepare the download. Open the chat and try again.")
      onDone()
    }, DOWNLOAD_PREPARE_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [onDone])

  return (
    <LongTakeExportProgressDialog
      download={download}
      thumbnailUrl={project?.resultVideoThumbnail}
      videoUrl={progress.videoUrl ?? undefined}
    />
  )
}

/**
 * The project items of the agent sidebar's row menu, reusing the project tools: the editor
 * link (a full page load), the editor's Download flow, the Projects page's rename call and
 * delete dialog. Deleting a project keeps its chat.
 */
export function useSidebarProjectActions() {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()
  const refresh = useRefreshAgentSessions()
  const setDeleteDialog = useSetAtom(deleteProjectDialogAtom)
  const deleteDialog = useAtomValue(deleteProjectDialogAtom)
  const [downloading, setDownloading] = useState<null | string>(null)
  const [renaming, setRenaming] = useState<AgentSessionListItem | null>(null)

  // The delete dialog closed (deleted or cancelled): the row may now say "Project deleted".
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !deleteDialog.open) refresh()
    wasOpen.current = deleteDialog.open
  }, [deleteDialog.open, refresh])

  const openDelete = useCallback(
    async (projectId: string) => {
      try {
        const project = await queryClient.fetchQuery({
          queryFn: () => fetchProjectById(fetchApiDomain, projectId),
          queryKey: ['project', projectId],
        })
        if (project) setDeleteDialog({ open: true, project })
      } catch {
        toast.error("Couldn't open the project")
      }
    },
    [fetchApiDomain, queryClient, setDeleteDialog],
  )

  const finishRename = useCallback(
    async (name: null | string) => {
      const item = renaming
      setRenaming(null)
      const trimmed = name?.trim()
      if (!item?.project || !trimmed || trimmed === item.title) return
      try {
        await renameProject(fetchApiDomain, item.project.id, trimmed)
        void queryClient.invalidateQueries({ queryKey: ['project', item.project.id] })
        void queryClient.invalidateQueries({ queryKey: getProjectsQueryKeyPrefix() })
        refresh()
      } catch {
        toast.error('Failed to rename project. Please try again.')
      }
    },
    [fetchApiDomain, queryClient, refresh, renaming],
  )

  const rowMenu = useCallback(
    (item: AgentSessionListItem): ContextMenuItem[] => {
      const rules = sessionRowMenu(item)
      const projectId = item.project?.id
      if (!projectId) return []
      const items: ContextMenuItem[] = []
      if (rules.openInEditor)
        items.push({
          icon: <Editor className="size-4.5" />,
          label: 'Open in editor',
          onClick: () => hardNavigate(`/story-mode/${encodeURIComponent(projectId)}`),
        })
      if (rules.download)
        items.push({
          disabled: downloading !== null,
          icon: <DownloadCircle className="size-4.5" />,
          label: downloading === projectId ? 'Exporting...' : 'Download',
          onClick: () => setDownloading(projectId),
        })
      if (rules.renameProject)
        items.push({
          icon: <Edit className="size-4.5" />,
          label: 'Rename project',
          onClick: () => setRenaming(item),
        })
      if (rules.deleteProject)
        items.push({
          icon: <Delete className="size-4.5" />,
          label: 'Delete project',
          onClick: () => void openDelete(projectId),
          ...(rules.deleteProjectBlocked
            ? { disabled: true, tooltip: DELETE_WHILE_GENERATING_TOOLTIP }
            : {}),
        })
      return items
    },
    [downloading, openDelete],
  )

  // Stable across renders: DownloadRunner's effect lists it as a dep, and a changing
  // identity would re-run that effect (and so double-handle a persisting error).
  const onDownloadDone = useCallback(() => setDownloading(null), [])

  const dialogs: ReactNode = (
    <>
      <DeleteProjectDialog />
      {downloading && (
        <ProjectProgressProvider projectIds={[downloading]}>
          <DownloadRunner onDone={onDownloadDone} projectId={downloading} />
        </ProjectProgressProvider>
      )}
    </>
  )

  return { dialogs, finishRename, renamingId: renaming?.id ?? null, rowMenu }
}
