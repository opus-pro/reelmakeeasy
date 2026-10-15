import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import type { UserInfo } from '@reelmakeeasy/common/types/user'
import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import type { TranscriptData } from '@shared/types/agent/transcript'
import { isStoreUri } from '@reelmakeeasy/common/storage/stored-files'

/**
 * The calling user, assembled from the request context the way every long-take
 * route needs it. Extracted so the per-line PII-access exception the email read
 * requires lives in ONE place instead of being repeated at each call site.
 */
export function buildLongTakeRequestUser(): UserInfo {
  return {
    // eslint-disable-next-line @nx/workspace-no-pii-field-access
    email: getReqContext().pii?.email || '',
    orgId: getReqContext().org_id,
    sub: getReqContext().login_id,
    userId: getReqContext().user_id,
  } as UserInfo
}

export function normalizeDebugUri(url: null | string | undefined): null | string {
  const normalized = normalizeNullableText(url)
  if (!normalized) {
    return null
  }
  return isStoreUri(normalized) ? storeUriToUrl(normalized) : normalized
}

export function normalizeNullableText(value: null | string | undefined): null | string {
  const normalized = value?.trim()
  return normalized || null
}

export function normalizeStyleThumbnailUrl(url: null | string | undefined): null | string {
  return normalizeDebugUri(url)
}

export function pickFirstBoolean(...values: Array<boolean | null | undefined>): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value
    }
  }
  return null
}

export function pickFirstText(...values: Array<null | string | undefined>): null | string {
  for (const value of values) {
    const normalized = normalizeNullableText(value)
    if (normalized) {
      return normalized
    }
  }
  return null
}

export async function readOptionalJsonFile<T>(
  storage: Awaited<ReturnType<typeof createStorage>>,
  pathName: string,
): Promise<T | undefined> {
  try {
    return await storage.readJsonFile<T>(pathName)
  } catch {
    return undefined
  }
}

export async function readTranscript(
  storage: Awaited<ReturnType<typeof createStorage>>,
): Promise<null | TranscriptData> {
  return (
    (await readOptionalJsonFile<TranscriptData>(
      storage,
      STORY_LOADER_PATHS.transformedTranscriptPath,
    )) ?? null
  )
}

/** Project-storage path of the Topaz upscale trace. SSOT for readers. */
export const LONG_TAKE_UPSCALE_TRACE_PATH = 'long_take/upscale_trace.json'
