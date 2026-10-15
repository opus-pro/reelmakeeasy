'use client'

import {
  sanitizeFilename,
  triggerDownloadFromUrl,
} from '@reelmakeeasy/common/utils/browser-download-utils'
import { useCallback, useState } from 'react'

import { useApi } from './useApi'

export function useVideoDownload() {
  const { fetchApiDomain } = useApi()
  const [isDownloading, setIsDownloading] = useState(false)

  const download = useCallback(
    async (
      projectId: string,
      watermark: boolean,
      _routePrefix?: string,
      options?: { lipSync?: boolean },
    ) => {
      if (isDownloading) {
        return
      }
      try {
        setIsDownloading(true)
        const endpoint = `/api/project/${projectId}/download-url?watermark=${watermark}${
          options?.lipSync === undefined ? '' : `&lipSync=${options.lipSync}`
        }`
        const res = await fetchApiDomain<{ filename?: string; url: string }>(endpoint)
        if (!res.ok || !res.data) {
          throw new Error(res.error ?? 'Failed to get download URL')
        }
        // The CDN object is served with `content-disposition: attachment`, so plain navigation
        // downloads natively: the browser streams it to disk and can resume. Fetching the bytes
        // into an in-memory blob instead fails on large files and interrupted transfers.
        const fallbackName = `${sanitizeFilename(projectId)}${watermark ? '-watermark' : ''}.mp4`
        triggerDownloadFromUrl(res.data.url, res.data.filename || fallbackName)
      } finally {
        setIsDownloading(false)
      }
    },
    [fetchApiDomain, isDownloading],
  )

  return { download, isDownloading }
}
