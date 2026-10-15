import type { FetchApiDomain } from '@/hooks/useApi'

/**
 * Tell the backend which saved style produced this project.
 *
 * A style has no identity on the render path -- it arrives as loose strings --
 * so this call is the only link between a saved style and the videos made with
 * it. It is what makes "is this style being reused" answerable.
 *
 * Fire-and-forget: an analytics link must never delay navigation or surface an
 * error to someone who just submitted a video. The server write is idempotent
 * on (style, project), so a retry or a double submit records one use.
 */
export async function recordSavedStyleUse(
  fetchApiDomain: FetchApiDomain,
  savedStyleId: string,
  projectId: string,
): Promise<void> {
  if (!savedStyleId.trim() || !projectId.trim()) {
    return
  }
  try {
    await fetchApiDomain(`/api/user-saved-styles/${savedStyleId}/uses`, {
      data: { projectId },
      method: 'POST',
    })
  } catch {
    // Best-effort: a missed link costs one row of analytics, a thrown error
    // would cost the user their navigation.
  }
}
