'use client'

import type { LibrarySound, LibrarySoundPatch } from '@shared/types/api/sound-library'
import { useCallback, useEffect, useState } from 'react'

import { useApi } from '@/hooks/useApi'
import { useSignedUpload } from '@/hooks/useSignedUpload'

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The user's sound library (`/api/sounds`): the list, and upload, rename, favourite, remove. */
export function useSoundLibrary() {
  const { fetchApiDomain } = useApi()
  const { uploadFile } = useSignedUpload({ module: 'media-temp' })
  const [sounds, setSounds] = useState<LibrarySound[] | null>(null)
  const [error, setError] = useState<null | string>(null)
  const [uploading, setUploading] = useState(0)

  const reload = useCallback(async () => {
    try {
      setSounds((await fetchApiDomain<LibrarySound[]>('/api/sounds', { method: 'GET' })).data)
    } catch (e) {
      setError(errorText(e))
    }
  }, [fetchApiDomain])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Uploads files one by one; each lands in the library as it finishes. */
  const upload = useCallback(
    async (files: File[]) => {
      setError(null)
      setUploading((n) => n + files.length)
      for (const file of files) {
        try {
          const { fileUri } = await uploadFile(file, { tempScope: 'sound-library' })
          await fetchApiDomain<LibrarySound>('/api/sounds', { data: { fileUri, name: file.name }, method: 'POST' })
          await reload()
        } catch (e) {
          setError(`${file.name}: ${errorText(e)}`)
        } finally {
          setUploading((n) => n - 1)
        }
      }
    },
    [fetchApiDomain, reload, uploadFile],
  )

  const update = useCallback(
    async (id: string, patch: LibrarySoundPatch) => {
      // Shown at once; the server's order (favourites first) comes with the reload.
      setSounds((list) => list?.map((s) => (s.id === id ? { ...s, ...patch } : s)) ?? null)
      try {
        await fetchApiDomain('/api/sounds/{id}', { data: patch, method: 'PUT', pathParams: { id } })
      } catch (e) {
        setError(errorText(e))
      }
      await reload()
    },
    [fetchApiDomain, reload],
  )

  const remove = useCallback(
    async (id: string) => {
      setSounds((list) => list?.filter((s) => s.id !== id) ?? null)
      try {
        await fetchApiDomain('/api/sounds/{id}', { method: 'DELETE', pathParams: { id } })
      } catch (e) {
        setError(errorText(e))
        await reload()
      }
    },
    [fetchApiDomain, reload],
  )

  return { error, reload, remove, sounds, update, upload, uploading }
}

export type SoundLibrary = ReturnType<typeof useSoundLibrary>
