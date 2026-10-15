import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { projectAtom, projectIdAtom, projectReplayModeAtom } from '@/atom/project'
import { isDemoProjectId } from '@/util/validator'

const EDITOR_CUTOFF_DATE = new Date('2025-11-20T00:00:00Z').getTime()

export function useEditorSettings() {
  const projectId = useAtomValue(projectIdAtom)
  const project = useAtomValue(projectAtom)
  const isReplyMode = useAtomValue(projectReplayModeAtom)

  const enableVideoEditor = useMemo(() => {
    // Exclude projects created before the cutoff date
    if (project?.createdAt) {
      const projectCreatedAt = new Date(project.createdAt).getTime()
      if (projectCreatedAt < EDITOR_CUTOFF_DATE) {
        return false
      }
    }

    return !isDemoProjectId(projectId) && !isReplyMode && !!project?.resultVideo
  }, [projectId, isReplyMode, project?.createdAt, project?.resultVideo])

  return {
    enableVideoEditor,
  }
}
