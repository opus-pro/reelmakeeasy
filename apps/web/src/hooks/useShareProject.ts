'use client'

import {
  AccessLevel,
  CreateSharedProjectBodyType,
  CreateSharedProjectResponse,
  SearchByProjectIdResponse,
  SharedProject,
  SharedProjectFullResponse,
  UpdateAccessLevelBodyType,
} from '@shared/types/api/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AxiosError } from 'axios'

import { isApiError } from '@/lib/api-error'

import { useApi } from './useApi'

export function useDeleteSharedProject() {
  const { fetchApiDomain } = useApi()

  const deleteSharedProject = useMutation({
    mutationFn: async (sharedProjectId: string): Promise<void> => {
      const response = await fetchApiDomain<void>(`/api/shared/${sharedProjectId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error('Failed to delete shared project')
      }
      return response.data
    },
  })

  return {
    deleteSharedProject,
    isPending: deleteSharedProject.isPending,
    isSuccess: deleteSharedProject.isSuccess,
    error: deleteSharedProject.error,
  }
}
export function useProjectByShareId(shareId: string) {
  const { fetchApiDomain } = useApi()

  const projectByShareId = useQuery({
    queryKey: ['projectByShareId', shareId],
    queryFn: async () => {
      const response = await fetchApiDomain<SharedProjectFullResponse>(`/api/shared/${shareId}`)
      return response.data.data
    },
    enabled: !!shareId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    // Don't retry on 403/404 (access denied), but allow retries for other errors
    retry: (failureCount, error) => {
      if (isApiError(error) && (error.isForbidden || error.isNotFound)) {
        return false
      }
      return failureCount < 3
    },
  })

  return {
    isPending: projectByShareId.isPending,
    isSuccess: projectByShareId.isSuccess,
    isError: projectByShareId.isError,
    error: projectByShareId.error,
    project: projectByShareId.data,
    refetch: projectByShareId.refetch,
  }
}
export function useSearchByProjectId(projectId: string, enabled = true) {
  const { fetchApiDomain } = useApi()

  const searchByProjectId = useQuery({
    queryKey: ['searchByProjectId', projectId],
    queryFn: async (): Promise<SharedProject> => {
      const response = await fetchApiDomain<SearchByProjectIdResponse>(
        `/api/shared/search-by-project-id/${projectId}`,
      )
      return response.data.data
    },
    enabled: !!projectId && enabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  })

  return {
    searchByProjectId,
    isPending: searchByProjectId.isPending,
    isSuccess: searchByProjectId.isSuccess,
    error: searchByProjectId.error,
    sharedProject: searchByProjectId.data,
    sharedProjectId: searchByProjectId.data?.sharedProjectId ?? '',
    accessLevel: searchByProjectId.data?.accessLevel ?? AccessLevel.PRIVATE,
    refetch: searchByProjectId.refetch,
  }
}
export function useShareProject() {
  const { fetchApiDomain } = useApi()

  const createSharedProject = useMutation<
    string,
    AxiosError<{ message: string }>,
    CreateSharedProjectBodyType
  >({
    mutationFn: async (data: CreateSharedProjectBodyType): Promise<string> => {
      const response = await fetchApiDomain<CreateSharedProjectResponse>('/api/shared', {
        method: 'POST',
        data,
      })

      if (!response.ok) {
        throw new Error('Failed to create shared project')
      }
      if (response.data.error) {
        throw new Error(response.data.error)
      }
      return response.data.data.sharedProjectId
    },
  })

  return {
    createSharedProject,
    isCreating: createSharedProject.isPending,
    isSuccess: createSharedProject.isSuccess,
    error: createSharedProject.error,
    sharedProjectId: createSharedProject.data,
  }
}

export function useUpdateAccessLevel() {
  const { fetchApiDomain } = useApi()

  const updateAccessLevel = useMutation<
    void,
    AxiosError<{ message: string }>,
    UpdateAccessLevelBodyType & { sharedProjectId: string }
  >({
    mutationFn: async ({ sharedProjectId, accessLevel }): Promise<void> => {
      const response = await fetchApiDomain(`/api/shared/${sharedProjectId}`, {
        method: 'PUT',
        data: { accessLevel },
      })
      if (!response.ok) {
        throw new Error('Failed to update access level')
      }
    },
  })

  return {
    updateAccessLevel,
    isUpdating: updateAccessLevel.isPending,
  }
}
