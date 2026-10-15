import { useEffect, useRef } from 'react'

/**
 * Marketing deep-link query key: `?select-video-model=<modelId>`
 * on the dashboard. Kebab-case like the other dashboard deep-link keys
 * (`quick-start-template`).
 */
export const SELECT_VIDEO_MODEL_QUERY_KEY = 'select-video-model'

type RemoveQuery = (keys: string[], options?: { mode?: 'push' | 'replace' }) => void

type SearchParamsLike = {
  get(name: string): null | string
}

/**
 * Consume the `select-video-model` deep-link param once per value.
 *
 * The video model selector is off, so no requested id can match a selectable
 * model: every value is tracked as `invalid` and the param is stripped so
 * refreshes and shares do not re-trigger.
 */
export function useVideoModelDeepLink({
  removeQuery,
  searchParams,
}: {
  removeQuery: RemoveQuery
  searchParams: null | SearchParamsLike
}): void {
  const requestedModelId = searchParams?.get(SELECT_VIDEO_MODEL_QUERY_KEY) ?? null

  // One-shot per param value: the strip below already prevents most re-runs,
  // but the effect can re-fire between removeQuery's microtask flush and the
  // URL actually changing, so guard on the handled value too.
  const handledModelIdRef = useRef<null | string>(null)

  useEffect(() => {
    // Reset once the param is gone (post-strip) so a later navigation to the
    // same deep-link value on this still-mounted page handles it again --
    // same lifecycle as handledDeepLinkKeyRef for the quick-start deep link.
    if (!requestedModelId) {
      handledModelIdRef.current = null
      return
    }
    if (handledModelIdRef.current === requestedModelId) {
      return
    }
    handledModelIdRef.current = requestedModelId
    removeQuery([SELECT_VIDEO_MODEL_QUERY_KEY], { mode: 'replace' })
  }, [removeQuery, requestedModelId])
}
