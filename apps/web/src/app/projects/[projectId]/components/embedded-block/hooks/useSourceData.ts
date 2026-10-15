import { SourceContent } from '@shared/types/chat/message-embedded-block'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { projectCardRecordAtom } from '@/atom/project'
import { SceneStageMessageAtom } from '@/atom/sceneCanvas'
import { useProjectId } from '@/contexts/ProjectContext'
import { useProjectAssets } from '@/hooks/useProjectAssets'

export const useSourceData = (): SourceContent[] => {
  const sceneStageMsg = useAtomValue(SceneStageMessageAtom)
  const { projectId } = useProjectId()
  const { data: projectAssets = [] } = useProjectAssets(projectId)
  const projectCardRecord = useAtomValue(projectCardRecordAtom)

  return useMemo(() => {
    if (sceneStageMsg?.type === 'embedded-source') {
      return sceneStageMsg.content.data || []
    }

    const sourceMsg = projectCardRecord['embedded-source']
    if (sourceMsg) {
      return sourceMsg.content?.data || []
    }

    return projectAssets
      .filter((a) => a.type === 'image')
      .map(
        (a) =>
          ({
            type: 'image',
            description: a.description || '',
            id: a.id || '',
            name: a.metadata?.source_query || '',
            previewImageUrl: a.preview_url || '',
            url: a.preview_path || '',
          }) as SourceContent,
      )
  }, [sceneStageMsg, projectAssets, projectCardRecord])
}
