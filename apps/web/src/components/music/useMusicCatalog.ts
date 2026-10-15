'use client'

import type { MusicCatalog } from '@reelmakeeasy/common/long-take/music-craft'
import type {
  MusicLibraryResponse,
  MusicLibraryTrackDto,
  UserMusicTrackCreateResponse,
  UserMusicTrackDto,
  UserMusicTracksResponse,
} from '@shared/types/api/music'
import { atom, useAtom } from 'jotai'
import { useCallback, useEffect, useMemo } from 'react'

import { useApi } from '@/hooks/useApi'
import { useSignedUpload } from '@/hooks/useSignedUpload'

/** The built-in library and the user's own tracks, loaded once and shared by every menu. */
export const musicLibraryAtom = atom<MusicLibraryTrackDto[] | null>(null)
export const myMusicTracksAtom = atom<null | UserMusicTrackDto[]>(null)
/** Both lists came back: only then is a stored track that is missing really gone. */
export const musicCatalogLoadedAtom = atom(false)

/** A user's track can be up to this big (the API checks it again, with the length). */
export const MAX_MUSIC_TRACK_BYTES = 50 * 1024 * 1024

let inflight: null | Promise<void> = null

/**
 * The music the menus offer: the library, the user's tracks, and the actions on them
 * (upload through a temp signed URL, then `POST /api/music/tracks`; delete).
 */
export function useMusicCatalog() {
  const { fetchApiDomain } = useApi()
  const [library, setLibrary] = useAtom(musicLibraryAtom)
  const [mine, setMine] = useAtom(myMusicTracksAtom)
  const [loaded, setLoaded] = useAtom(musicCatalogLoadedAtom)
  const { uploadFile } = useSignedUpload({ module: 'media-temp' })

  const load = useCallback(async () => {
    const [lib, tracks] = await Promise.all([
      fetchApiDomain<MusicLibraryResponse>('/api/music/library', {
        method: 'GET',
        noThrowError: true,
      }),
      fetchApiDomain<UserMusicTracksResponse>('/api/music/tracks', {
        method: 'GET',
        noThrowError: true,
      }),
    ])
    // A failed re-read keeps what was already shown; a first failure shows empty lists.
    setLibrary((prev) => (lib.ok ? (lib.data?.data?.tracks ?? []) : (prev ?? [])))
    setMine((prev) => (tracks.ok ? (tracks.data?.data?.tracks ?? []) : (prev ?? [])))
    setLoaded((prev) => prev || (lib.ok && tracks.ok))
  }, [fetchApiDomain, setLibrary, setLoaded, setMine])

  /** Reads both lists again; one read at a time for every menu on the page. */
  const refresh = useCallback(() => {
    inflight ??= load().finally(() => {
      inflight = null
    })
    return inflight
  }, [load])

  useEffect(() => {
    if (library !== null && mine !== null) return
    void refresh()
  }, [library, mine, refresh])

  /** Uploads a file as the user's track; throws with the API's reason when it is refused. */
  const upload = useCallback(
    async (file: File, name: string): Promise<UserMusicTrackDto> => {
      const { fileUri } = await uploadFile(file, { tempScope: 'music-track' })
      const response = await fetchApiDomain<UserMusicTrackCreateResponse>('/api/music/tracks', {
        data: { name, tempFileUri: fileUri },
        method: 'POST',
        noThrowError: true,
      })
      const track = response.ok ? response.data?.data : undefined
      if (!track) throw new Error(response.error || 'Could not save the track.')
      setMine((prev) => [track, ...(prev ?? [])])
      return track
    },
    [fetchApiDomain, setMine, uploadFile],
  )

  const remove = useCallback(
    async (id: string) => {
      const response = await fetchApiDomain(`/api/music/tracks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        noThrowError: true,
      })
      if (!response.ok) throw new Error(response.error || 'Could not delete the track.')
      setMine((prev) => prev?.filter((t) => t.id !== id) ?? null)
    },
    [fetchApiDomain, setMine],
  )

  const catalog: MusicCatalog = useMemo(
    () => ({
      library: (library ?? []).map((t) => ({
        description: t.description,
        id: t.id,
        mood: t.mood,
        title: t.title,
      })),
      mine: (mine ?? []).map((t) => ({ id: t.id, name: t.name })),
    }),
    [library, mine],
  )

  return {
    catalog,
    library: library ?? [],
    loaded,
    mine: mine ?? [],
    refresh,
    remove,
    upload,
  }
}
