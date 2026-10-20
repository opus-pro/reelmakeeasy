'use client'

import type { AgentSession } from '@shared/types/api/agent'
import type {
  RankingProject,
  RankingProjectPatch,
  RankingProjectSummary,
  RankingRenderStatus,
  RankingTemplate,
  RankingTemplateInput,
} from '@shared/types/api/ranking'
import { useMemo } from 'react'

import { useApi } from '@/hooks/useApi'

/** The Ranking Builder's API calls (`/api/ranking/...`). Errors throw with the API's message. */
export function useRankingApi() {
  const { fetchApiDomain } = useApi()
  return useMemo(
    () => ({
      addStickerImage: async (id: string, fileUri: string, name: string) =>
        (
          await fetchApiDomain<{ imageUrl: string }>('/api/ranking/projects/{id}/sticker-images', {
            data: { fileUri, name },
            method: 'POST',
            pathParams: { id },
          })
        ).data,
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
      deleteStyle: async (id: string) => {
        await fetchApiDomain('/api/ranking/styles/{id}', { method: 'DELETE', pathParams: { id } })
      },
      /** A new Ranking chat on this ranking (its mode chosen); answers the chat's id. */
      openChat: async (rankingId: string, title: string) =>
        (await fetchApiDomain<AgentSession>('/api/agent/sessions', { data: { rankingId, title }, method: 'POST' })).data
          .id,
      styles: async () =>
        (await fetchApiDomain<RankingTemplate[]>('/api/ranking/styles', { method: 'GET' })).data,
      updateStyle: async (id: string, patch: Partial<RankingTemplateInput>) =>
        (
          await fetchApiDomain<RankingTemplate>('/api/ranking/styles/{id}', {
            data: patch,
            method: 'PUT',
            pathParams: { id },
          })
        ).data,
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
