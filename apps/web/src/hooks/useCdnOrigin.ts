import { useAtomValue } from 'jotai'

import { apiOriginAtom } from '@/atom/apiOrigin'

/**
 * Where the API serves stored files from (`<api>/api/files`), the origin the project
 * file URL helpers in `util/cdn-utils` build on.
 */
export function useCdnOrigin(): string {
  const apiOrigin = useAtomValue(apiOriginAtom)
  return `${apiOrigin.replace(/\/$/, '')}/api/files`
}
