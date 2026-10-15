import { RenderTemplate } from '@reelmakeeasy/common/template/type'
import { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import { useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'

import { syncVideoScriptToStore } from '@/app/projects/[projectId]/editor/utils/sync-video-script-to-store'
import { useRefAtomCallback } from '@/hooks/use-ref-callback'
import { useApi } from '@/hooks/useApi'
import { useVideoScript } from '@/hooks/useVideoScript'

import { UpdateManager } from '../instances/update-manager'
import { editorCoreStore } from '../stores/editor-core.store'
import { editorHistoryStore } from '../stores/editor-history.store'

const nsLogger = Logger.get('project.data-initialize')

export function useDataInitialize(projectId: string) {
  const { fetchApiDomain } = useApi()
  const setTemplateList = useSetAtom(editorCoreStore.templateList)
  const initializedProjectId = useRef<string>('')
  const [isInitializing, setIsInitializing] = useState(false)

  const { data: videoScript, isLoading: isLoadingVideoScript } = useVideoScript(projectId)

  const templateListQuery = useQuery({
    queryFn: async () => {
      const response = await fetchApiDomain<{ data: { templates: RenderTemplate[] } }>(
        '/api/templates',
        { method: 'GET' },
      )
      return response.data.data.templates
    },
    queryKey: ['template-list'],
    retry: 2,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  })

  const templateList = templateListQuery.data
  const isLoadingTemplateList = templateListQuery.isLoading

  useEffect(() => {
    setTemplateList(templateList)
  }, [templateList, setTemplateList])

  const initializeHistory = useSetAtom(editorHistoryStore.initializeHistoryAtom)

  const initDelInstance = useRefAtomCallback(async (_get, set, videoScript: VideoScript) => {
    const actualVideoScript = await initializeHistory({ projectId, videoScript })
    syncVideoScriptToStore(set, actualVideoScript ?? videoScript)

    UpdateManager.getInstance().init(set, {
      'template-asset': editorCoreStore.templateTrack,
    })
  })

  useEffect(() => {
    const shouldInitialize =
      videoScript &&
      !isLoadingVideoScript &&
      projectId &&
      initializedProjectId.current !== projectId

    if (shouldInitialize) {
      initializedProjectId.current = projectId
      setIsInitializing(true)
      initDelInstance(videoScript)
        .catch((error) => {
          nsLogger.error('Failed to initialize editor instance:', error)
        })
        .finally(() => {
          setIsInitializing(false)
        })
    }
  }, [videoScript, isLoadingVideoScript, projectId, initializeHistory, initDelInstance])

  const isLoading = useMemo(
    () => isLoadingVideoScript || isLoadingTemplateList || isInitializing,
    [isLoadingVideoScript, isLoadingTemplateList, isInitializing],
  )

  return { isLoading }
}
