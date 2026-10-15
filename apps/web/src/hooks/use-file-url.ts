import { isStoreUri, storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { useAtomValue } from 'jotai'

import { fileOriginAtom } from '@/atom/apiOrigin'

import { useRefCallback } from './use-ref-callback'

export function useFileUrl() {
  const fileOrigin = useAtomValue(fileOriginAtom)

  const parseUrl = useRefCallback((projectId: string, filePath: string, forceHost?: string) => {
    if (!filePath) {
      return ''
    }
    if (filePath.match(/^https?:\/\//)) {
      return filePath
    }
    if (isStoreUri(filePath)) {
      return storeUriToUrl(filePath)
    }
    const origin = forceHost || fileOrigin
    const trimEnd = origin.endsWith('/') ? origin.slice(0, -1) : origin
    return [trimEnd, projectId, filePath].join('/')
  })
  const addImgHostname = useRefCallback((filePath = '', forceHost?: string) => {
    if (!filePath) {
      return ''
    }
    if (filePath.match(/^https?:\/\//)) {
      return filePath
    }
    if (isStoreUri(filePath)) {
      return storeUriToUrl(filePath)
    }

    const origin = forceHost || fileOrigin
    const trimEnd = origin.endsWith('/') ? origin.slice(0, -1) : origin

    return [trimEnd, filePath].join('/')
  })

  return {
    addImgHostname,
    parseUrl,
  }
}
