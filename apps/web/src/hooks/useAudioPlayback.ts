import { isStoreUri, storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { useCallback, useEffect, useRef, useState } from 'react'

import { AudioPlayer } from '@/util/audio-player'

export function resolvePlayableAudioUrl(candidates: Array<null | string | undefined>): string {
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (!value) {
      continue
    }
    if (
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('blob:') ||
      value.startsWith('data:')
    ) {
      return value
    }
    if (isStoreUri(value)) {
      return storeUriToUrl(value)
    }
  }
  return ''
}

export function useAudioPlayback(audioUrl: string) {
  const [player, setPlayer] = useState<AudioPlayer>()
  const [progress, setProgress] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  // Rebuild the player when the OBJECT changes, not when only its query string
  // does. Keying the effect on the raw string would tear the player down
  // (resetting progress and pausing playback) whenever a session poll -- every
  // 2s in the planner -- brought the same object back under a different query.
  // Dropping the query yields a stable identity; the ref keeps the latest URL
  // for the player that identity does build.
  const playbackIdentity = audioUrl.split('?')[0] ?? ''
  const latestAudioUrlRef = useRef(audioUrl)

  // Synced in an effect, not during render: writing a ref while rendering is
  // unsafe under concurrent rendering, where a render can be discarded. Declared
  // BEFORE the player effect so React's in-order execution has the freshest URL
  // ready by the time a new identity builds a player.
  useEffect(() => {
    latestAudioUrlRef.current = audioUrl
  }, [audioUrl])

  useEffect(() => {
    if (!playbackIdentity) {
      setPlayer(undefined)
      setProgress(0)
      setIsPlaying(false)
      return
    }

    const nextPlayer = new AudioPlayer(latestAudioUrlRef.current, {
      onEnded: () => setIsPlaying(false),
      onPause: () => setIsPlaying(false),
      onPlay: () => setIsPlaying(true),
      onTimeUpdate: (currentTime, duration) => {
        setProgress(duration > 0 ? Math.max(0, Math.min(currentTime / duration, 1)) : 0)
      },
    })

    setPlayer(nextPlayer)
    setProgress(0)
    setIsPlaying(false)

    return () => {
      nextPlayer.destroy()
    }
    // `latestAudioUrlRef` is deliberately not a dependency: a new URL for the
    // same object must not tear the player down. See `playbackIdentity`.
  }, [playbackIdentity])

  useEffect(() => {
    if (!player) {
      return
    }
    if (isPlaying) {
      player.play()
      return
    }
    player.reset()
  }, [isPlaying, player])

  const togglePlayback = useCallback(() => {
    if (!player) {
      return
    }
    setIsPlaying((previous) => !previous)
  }, [player])

  return {
    isPlaying,
    progress,
    togglePlayback,
  }
}
