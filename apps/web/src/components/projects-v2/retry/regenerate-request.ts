import type { useApi } from '@/hooks/useApi'

type FetchApiDomain = ReturnType<typeof useApi>['fetchApiDomain']

/**
 * Start a regeneration of a long-take on the given transition video model. The
 * endpoint requires a registry key (e.g. the `video.firstLast` role's key from
 * `GET /api/models`); legacy ids are rejected. The server reuses the source
 * project's artifacts through keyframes and produces a new project; returns the
 * new project's id, or null on failure.
 */
export async function requestRegenerate(
  fetchApiDomain: FetchApiDomain,
  projectId: string,
  transitionVideoModel: string,
): Promise<null | string> {
  const res = await fetchApiDomain<{ projectId?: string }>(
    `/api/long-take-videos/${projectId}/regenerate`,
    { data: { transitionVideoModel }, method: 'POST' },
  )
  return res.ok ? (res.data?.projectId ?? null) : null
}
