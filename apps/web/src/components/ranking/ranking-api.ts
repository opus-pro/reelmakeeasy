'use client'

import type {
  RankingProject,
  RankingProjectPatch,
  RankingProjectSummary,
  RankingRenderStatus,
} from '@shared/types/api/ranking'
import { useMemo } from 'react'

import { useApi } from '@/hooks/useApi'

/** The Ranking Builder's API calls (`/api/ranking/...`). Errors throw with the API's message. */
export function useRankingApi() {
  const { fetchApiDomain } = useApi()
  return useMemo(
    () => ({
      create: async (name?: string) =>
        (await fetchApiDomain<RankingProject>('/api/ranking/projects', { data: { name }, method: 'POST' }))
          .data,
      get: async (id: string) =>
        (
          await fetchApiDomain<RankingProject>('/api/ranking/projects/{id}', {
            method: 'GET',
            pathParams: { id },
          })
        ).data,
      list: async () =>
        (await fetchApiDomain<RankingProjectSummary[]>('/api/ranking/projects', { method: 'GET' })).data,
      remove: async (id: string) => {
        await fetchApiDomain('/api/ranking/projects/{id}', { method: 'DELETE', pathParams: { id } })
      },
      render: async (id: string, bandHeight: number, overlays: string[]) =>
        (
          await fetchApiDomain<RankingRenderStatus>('/api/ranking/projects/{id}/render', {
            data: { bandHeight, overlays },
            method: 'POST',
            pathParams: { id },
          })
        ).data,
      renderStatus: async (renderId: string) =>
        (
          await fetchApiDomain<RankingRenderStatus>('/api/ranking/renders/{renderId}', {
            method: 'GET',
            pathParams: { renderId },
          })
        ).data,
      setClip: async (id: string, itemId: string, fileUri: string, name: string) =>
        (
          await fetchApiDomain<RankingProject>('/api/ranking/projects/{id}/items/{itemId}/clip', {
            data: { fileUri, name },
            method: 'POST',
            pathParams: { id, itemId },
          })
        ).data,
      update: async (id: string, patch: RankingProjectPatch) =>
        (
          await fetchApiDomain<RankingProject>('/api/ranking/projects/{id}', {
            data: patch,
            method: 'PUT',
            pathParams: { id },
          })
        ).data,
    }),
    [fetchApiDomain],
  )
}

export type RankingApi = ReturnType<typeof useRankingApi>
