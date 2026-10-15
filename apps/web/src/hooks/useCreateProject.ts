'use client'

import { AspectRatio } from '@reelmakeeasy/common/media/types'
import {
  ProjectCreateRequestBody,
  ProjectForBackend,
  ProjectVoiceOverJson,
} from '@shared/types/api/project'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { CreateUseCaseKey } from '@/constants/create-use-cases'

import { useApi } from './useApi'

/**
 * Hook to create a project (POST /api/project)
 */
export function useCreateProject() {
  const { fetchApiDomain: fetchWithProjectId } = useApi()
  const queryClient = useQueryClient()

  type CreateProjectPayload = {
    attachmentIds?: string[]
    avatarId?: string
    bgmEnabled?: boolean
    createUseCase?: CreateUseCaseKey
    enableCaption?: boolean
    isLongTake?: boolean
    longTakeInput?: 'audio' | 'transcript'
    longTakeRatio?: AspectRatio
    modelSelectorTier?: ProjectCreateRequestBody['modelSelectorTier']
    projectTier?: 'LITE' | 'PRO'
    text: string
    voice?: ProjectVoiceOverJson
  }

  const createProject = useMutation({
    mutationFn: async (params: CreateProjectPayload): Promise<ProjectForBackend> => {
      const {
        text,
        voice,
        attachmentIds,
        avatarId,
        bgmEnabled,
        createUseCase,
        enableCaption,
        isLongTake,
        longTakeInput,
        longTakeRatio,
        modelSelectorTier,
        projectTier,
      } = params

      const data: ProjectCreateRequestBody = {
        initialText: text,
        voice,
        attachmentIds, // will use all records from db
        avatarId,
        bgmEnabled,
        createUseCase,
        enableCaption,
        isLongTake,
        longTakeInput,
        longTakeRatio,
        modelSelectorTier,
        projectTier,
      }

      const response = await fetchWithProjectId<ProjectForBackend>('/api/project', {
        method: 'POST',
        data,
      })

      if (!response.ok) {
        throw new Error('Failed to create project')
      }

      return response.data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  return {
    createProject: createProject.mutate,
    createProjectAsync: createProject.mutateAsync,
    error: createProject.error,
    isLoading: createProject.isPending,
    isSuccess: createProject.isSuccess,
  }
}
