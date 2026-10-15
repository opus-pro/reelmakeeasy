'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useApi } from './useApi'

export interface CreateUserSavedStyleInput {
  imageDataUrl?: string
  name: string
  // History accumulated client-side before save. Flushed as the
  // style's initial snapshots; the BE promotes previews + caps the list.
  snapshots?: StyleSnapshotInput[]
  styleInputMode: UserSavedStyleInputMode
  // Structured extras from the custom-style generator (summary / analysis /
  // colorPalette). Persisted into the additive styleMetadata column.
  // Omitted by the legacy single-modal flow.
  styleMetadata?: Record<string, unknown>
  styleText: string
  thumbnailUrl?: string
}

// Structured style analysis persisted with a saved style.
export interface StyleAnalysis {
  canFlex: string[]
  failureModes: string[]
  intent: string
  staysConsistent: string[]
  visualRules: string[]
}

export interface StyleColorPalette {
  accent: null | string[]
  primary: null | string[]
  secondary: null | string[]
}

// One generate/refine step the FE wants persisted (matches the BE
// SnapshotInputDto). Scene previews are the ephemeral CDN URLs the render
// endpoint returned; the BE promotes them to durable per-style paths.
export interface StyleSnapshotInput {
  analysis?: StyleAnalysis
  colorPalette?: StyleColorPalette
  reusableStylePrompt: string
  scenePreviews: { archetypeId: string; imageUrl: string }[]
  summary?: string
  // The chat message that produced this refine; absent for the initial generate.
  userRequest?: string
}

// One persisted history entry read back from GET :id. Previews are the durable
// CDN URLs (ordered portrait/landscape/action); restoredFromId is set when the
// entry was produced by a restore (append-a-copy).
export interface StyleSnapshot {
  analysis: null | StyleAnalysis
  colorPalette: null | StyleColorPalette
  createdAt: string
  id: string
  restoredFromId: null | string
  reusableStylePrompt: string
  scenePreviewUrls: string[]
  summary: null | string
  userRequest: null | string
}

// Full record from GET :id -- the list endpoint omits `styleMetadata`. Both the
// list and detail endpoints return the embedded `snapshots` array (Prisma
// findMany/findFirst select every field by default), so the rendered scene
// previews are available without a separate GET :id.
export interface UserSavedStyle {
  createdAt: string
  // Which Style Maker created it, computed server-side: 'studio' (new
  // custom-style Studio) or 'legacy' (old picker). Drives the reuse-analytics
  // new-vs-legacy split; optional so older clients/cached payloads still parse.
  createdVia?: 'legacy' | 'studio'
  // Full composed style used for generation. Falls back to styleText
  // (the short display prompt) for legacy rows / styles saved before the field.
  generationStyleText?: null | string
  id: string
  name: string
  orgId?: null | string
  originalImageUri?: null | string
  // Append-only generate/refine history; the latest entry's scenePreviewUrls are
  // the durable rendered scene images used as the card's front image / carousel.
  snapshots?: StyleSnapshot[]
  styleInputMode: UserSavedStyleInputMode
  styleText: string
  thumbnailUrl?: null | string
  updatedAt: string
  userId: string
}

export interface UserSavedStyleDetail extends UserSavedStyle {
  styleMetadata?: null | Record<string, unknown>
}

// The durable, rendered scene-preview URLs of a saved style's latest snapshot,
// ordered portrait/landscape/action. These are the images the card should show
// (the saved `thumbnailUrl` is the uploaded reference, not a rendered scene).
export type UserSavedStyleInputMode = 'image' | 'text'

export function latestScenePreviewUrls(style: { snapshots?: StyleSnapshot[] }): string[] {
  const snapshots = style.snapshots ?? []
  return snapshots[snapshots.length - 1]?.scenePreviewUrls ?? []
}

const USER_SAVED_STYLES_QUERY_KEY = ['user-saved-styles']

const userSavedStyleQueryKey = (id: string) => ['user-saved-styles', id]

export interface GenerateStylePreviewInput {
  baseImageUrl: string
  styleText: string
}

export interface GenerateStylePreviewResult {
  previewImageBase64: string
}

export function useDeleteUserStyle() {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchApiDomain(`/api/user-saved-styles/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to delete saved style')
      }

      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USER_SAVED_STYLES_QUERY_KEY })
    },
  })
}

export function useSaveUserStyle() {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateUserSavedStyleInput) => {
      const response = await fetchApiDomain<UserSavedStyle>('/api/user-saved-styles', {
        data: input,
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to save style')
      }

      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USER_SAVED_STYLES_QUERY_KEY })
    },
  })
}

/**
 * Mutation to generate a styled preview image via POST /api/media/generate-style-preview.
 * Input: { styleText, baseImageUrl }. Output: { previewImageBase64 }.
 */
export function useGenerateStyleName() {
  const { fetchApiDomain } = useApi()

  return useMutation({
    mutationFn: async (styleText: string) => {
      const response = await fetchApiDomain<{ styleName: string }>(
        '/api/media/generate-style-name',
        { data: { styleText }, method: 'POST' },
      )

      if (!response.ok) {
        throw new Error(response.error || 'Failed to generate style name')
      }

      return response.data
    },
  })
}

export function useGenerateStylePreview() {
  const { fetchApiDomain } = useApi()

  return useMutation({
    mutationFn: async (input: GenerateStylePreviewInput) => {
      const response = await fetchApiDomain<GenerateStylePreviewResult>(
        '/api/media/generate-style-preview',
        {
          data: {
            baseImageUrl: input.baseImageUrl,
            styleText: input.styleText,
          },
          method: 'POST',
        },
      )

      if (!response.ok) {
        throw new Error(response.error || 'Failed to generate style preview')
      }

      return response.data
    },
  })
}

/**
 * PUT /api/user-saved-styles/:id -- persist edits to a saved style's mutable
 * fields (currently `name`; `styleText` is also accepted by the BE). Used to
 * persist an inline rename of a reopened style so the saved record + gallery
 * card reflect the new name.
 */
export function useUpdateStyleThumbnail() {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, imageDataUrl }: { id: string; imageDataUrl: string }) => {
      const response = await fetchApiDomain<UserSavedStyle>(
        `/api/user-saved-styles/${id}/thumbnail`,
        { data: { imageDataUrl }, method: 'POST' },
      )

      if (!response.ok) {
        throw new Error(response.error || 'Failed to update style thumbnail')
      }

      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USER_SAVED_STYLES_QUERY_KEY })
    },
  })
}

export function useUpdateStyleThumbnailFromUrl() {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, thumbnailUrl }: { id: string; thumbnailUrl: string }) => {
      const response = await fetchApiDomain<UserSavedStyle>(
        `/api/user-saved-styles/${id}/thumbnail-url`,
        { data: { thumbnailUrl }, method: 'POST' },
      )

      if (!response.ok) {
        throw new Error(response.error || 'Failed to update style thumbnail')
      }

      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USER_SAVED_STYLES_QUERY_KEY })
    },
  })
}

export function useUpdateUserSavedStyle() {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      name,
      styleText,
    }: {
      id: string
      name?: string
      styleText?: string
    }) => {
      const response = await fetchApiDomain<UserSavedStyle>(`/api/user-saved-styles/${id}`, {
        data: { name, styleText },
        method: 'PUT',
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to update saved style')
      }

      return response.data
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: USER_SAVED_STYLES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: userSavedStyleQueryKey(id) })
    },
  })
}

/**
 * GET /api/user-saved-styles/:id -- the FULL record (snapshots + styleMetadata),
 * unlike the list endpoint. Drives the reopen + History experience.
 */
export function useUserSavedStyle(id?: string) {
  const { fetchApiDomain } = useApi()

  return useQuery<UserSavedStyleDetail>({
    enabled: Boolean(id),
    queryFn: async () => {
      const response = await fetchApiDomain<UserSavedStyleDetail>(`/api/user-saved-styles/${id}`, {
        method: 'GET',
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch saved style')
      }
      if (!response.data) {
        throw new Error('Failed to fetch saved style: empty response')
      }

      return response.data
    },
    queryKey: userSavedStyleQueryKey(id ?? ''),
    // Reopen must be resilient to the transient detail-fetch blips behind the
    // flaky "couldn't open the old style" reports: retry a few times on a short
    // backoff so a one-off failure self-heals, and a persistent failure still
    // settles to `isError` within a few seconds (so the studio's retry UI shows)
    // instead of sitting on the spinner for react-query's long default backoff.
    retry: 3,
    retryDelay: (attempt) => Math.min(600 * 2 ** attempt, 2500),
    staleTime: 0,
  })
}

export function useUserSavedStyles() {
  const { fetchApiDomain } = useApi()

  const { data, error, isLoading, refetch } = useQuery<UserSavedStyle[]>({
    queryFn: async () => {
      const response = await fetchApiDomain<UserSavedStyle[]>('/api/user-saved-styles', {
        method: 'GET',
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch user saved styles')
      }

      return response.data || []
    },
    queryKey: USER_SAVED_STYLES_QUERY_KEY,
    staleTime: 0,
  })

  return {
    error: error?.message,
    isLoading,
    refetch,
    styles: data ?? [],
  }
}
