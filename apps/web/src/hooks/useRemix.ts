'use client'
import { toast } from '@shared/ui'
import { useRef, useState } from 'react'

import { REMIX_QUERY_KEY } from '@/app/home/constants/urlTransferKeys'
import { useQuickStartNavigation } from '@/app/home/hooks/useQuickStartNavigation'
import {
  buildProjectListRemixPayload,
  resolveStyleForRemix,
  type UserUploadedAssetsResponse,
} from '@/components/projects-v2/project-list-card-remix.utils'
import { fetchProjectById } from '@/hooks/projects-query-utils'
import { useApi } from '@/hooks/useApi'
import { setUrlTransfer } from '@/hooks/useUrlTransfer'
import { useUserSavedStyles } from '@/hooks/useUserSavedStyles'

export function useRemix(projectId: string, source = 'cancel_card') {
  const [isPreparingRemix, setIsPreparingRemix] = useState(false)
  const isPreparingRemixRef = useRef(false)
  const { navigate } = useQuickStartNavigation()
  const { fetchApiDomain } = useApi()
  const { styles: userSavedStyles } = useUserSavedStyles()
  const handleRemix = async () => {
    if (isPreparingRemixRef.current) {
      return
    }
    isPreparingRemixRef.current = true
    setIsPreparingRemix(true)
    try {
      const [fullProject, uploadedAssetsRes] = await Promise.all([
        fetchProjectById(fetchApiDomain, projectId),
        fetchApiDomain<UserUploadedAssetsResponse>(`/api/media/attachments/${projectId}`, {
          noThrowError: true,
        }),
      ])
      if (!fullProject) {
        toast.error('Could not open remix. Please try again.')
        return
      }
      const uploadedAssets = uploadedAssetsRes.ok ? uploadedAssetsRes.data : null
      const resolvedStyle = resolveStyleForRemix(
        fullProject.styleText ?? null,
        fullProject.styleName ?? null,
        fullProject.styleThumbnailUrl ?? null,
        userSavedStyles,
        [],
      )
      // Carried on the project read, already signed -- the remix payload
      // must not contain a URL the browser composed for itself.
      const voiceoverAudioUrl = fullProject.voiceoverAudioUrl ?? undefined
      const payload = buildProjectListRemixPayload(
        fullProject,
        uploadedAssets,
        resolvedStyle,
        voiceoverAudioUrl,
      )
      const query = setUrlTransfer({ [REMIX_QUERY_KEY]: payload })
      navigate('story-mode', query)
    } catch {
      toast.error('Could not open remix. Please try again.')
    } finally {
      isPreparingRemixRef.current = false
      setIsPreparingRemix(false)
    }
  }

  return { handleRemix, isPreparingRemix }
}
