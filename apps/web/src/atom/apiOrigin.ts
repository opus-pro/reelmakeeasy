'use client'

import { API_ORIGIN, FILE_ORIGIN } from '@reelmakeeasy/common/constant/domain'
import { atom } from 'jotai'

// Set NEXT_PUBLIC_API_ORIGIN to target an API other than the local one.
function getDefaultApiOrigin(): string {
  return process.env.NEXT_PUBLIC_API_ORIGIN || API_ORIGIN.LOCAL
}

// Workspace files come from the same API (see FILE_ORIGIN).
function getDefaultFileOrigin(): string {
  const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN
  return apiOrigin
    ? FILE_ORIGIN.LOCAL.replace(API_ORIGIN.LOCAL, apiOrigin.replace(/\/$/, ''))
    : FILE_ORIGIN.LOCAL
}

export const apiOriginAtom = atom(getDefaultApiOrigin())
apiOriginAtom.debugLabel = 'apiOriginAtom'

export const fileOriginAtom = atom(getDefaultFileOrigin())
fileOriginAtom.debugLabel = 'fileOriginAtom'
