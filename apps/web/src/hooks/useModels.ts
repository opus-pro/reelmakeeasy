'use client'

import type { ModelKind, ModelRole, ModelsResponse } from '@shared/types/api/models'
import { useQuery } from '@tanstack/react-query'

import { useApi } from './useApi'

export const MODELS_QUERY_KEY = ['models'] as const

/**
 * The role Story Mode transitions run on when nothing is picked. First
 * generation and regenerate both resolve through it server-side.
 */
export const DEFAULT_VIDEO_ROLE: ModelRole = 'video.firstLast'

export interface ResolvedModelLabel {
  key: string
  label: string
}

/**
 * The model registry the API resolved (`GET /api/models`): which model serves
 * each role, plus every model's label and capabilities. The registry is process
 * config that only changes on an API restart, so it is fetched once per page.
 */
export function useModels() {
  const { fetchApiDomain } = useApi()
  return useQuery({
    queryKey: MODELS_QUERY_KEY,
    queryFn: async () => {
      const response = await fetchApiDomain<ModelsResponse>('/api/models', { method: 'GET' })
      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch models')
      }
      return response.data
    },
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })
}

/**
 * The registry entry an id names, matched like the server does: by registry key,
 * then by alias. Null when no entry of that kind matches.
 */
export function findRegistryModel(
  registry: ModelsResponse,
  kind: ModelKind,
  id: string,
): null | ResolvedModelLabel {
  const direct = registry.models[id]
  if (direct?.kind === kind) {
    return { key: id, label: direct.label }
  }
  const alias = Object.entries(registry.models).find(
    ([, model]) => model.kind === kind && model.aliases?.includes(id),
  )
  return alias ? { key: alias[0], label: alias[1].label } : null
}

/**
 * The model a persisted transition video id runs on, resolved the way the
 * server resolves it: a registry key or alias is that model; null, legacy
 * (Seedance, MiniMax, Veo 3.0) and unknown ids run on the default video role.
 * Null until the registry loads, or when the default role is disabled.
 */
export function resolveVideoModel(
  registry: ModelsResponse | undefined,
  id: null | string | undefined,
): null | ResolvedModelLabel {
  if (!registry) {
    return null
  }
  const trimmed = id?.trim()
  const match = trimmed ? findRegistryModel(registry, 'video', trimmed) : null
  if (match) {
    return match
  }
  const roleModel = registry.roles[DEFAULT_VIDEO_ROLE]
  return roleModel ? { key: roleModel.key, label: roleModel.label } : null
}

/** {@link resolveVideoModel} over the fetched registry. */
export function useResolvedVideoModel(id: null | string | undefined): null | ResolvedModelLabel {
  const { data } = useModels()
  return resolveVideoModel(data, id)
}

/**
 * The registry key of the default video role, for endpoints that still require
 * an explicit model id (regenerate). Undefined until the registry loads.
 */
export function useDefaultVideoModelKey(): string | undefined {
  const { data } = useModels()
  return data?.roles[DEFAULT_VIDEO_ROLE]?.key
}
