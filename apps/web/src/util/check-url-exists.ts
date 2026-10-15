import { Logger } from '@reelmakeeasy/common/utils/logger'

const nsLogger = Logger.get('check-url-exists')

const CACHE_TTL_MS = 5 * 60 * 1000

const urlExistsCache = new Map<string, { exists: boolean; timestamp: number }>()

const cleanupExpiredEntries = () => {
  const now = Date.now()
  for (const [key, value] of urlExistsCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL_MS) {
      urlExistsCache.delete(key)
    }
  }
}

export const checkUrlExists = async (url: string): Promise<boolean> => {
  cleanupExpiredEntries()

  const cached = urlExistsCache.get(url)
  const now = Date.now()

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.exists
  }

  try {
    const response = await fetch(url, { method: 'HEAD' })
    const exists = response.ok
    urlExistsCache.set(url, { exists, timestamp: now })
    return exists
  } catch {
    nsLogger.error(`Failed to check URL existence: ${url}`)
    urlExistsCache.set(url, { exists: false, timestamp: now })
    return false
  }
}
