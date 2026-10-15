'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { videoScriptQueryKey } from '@/hooks/useVideoScript'

/**
 * Reads the project's video script again when a video this panel saw generating is delivered.
 * The render saves the script with the file, but a read from before stays cached (useVideoScript
 * keeps it 5 minutes), so the previews would keep drawing the old script (no fact stamps for a
 * loop rendered before stamps were a track) until a reload.
 *
 * What it saw lives in this panel. LongTakeViewer mounts another panel when the video URL turns
 * on or off, so this catches a run seen while the delivered file stays on screen, such as a re-run
 * watched in the editor. A first generation needs nothing: the script is read only once there is
 * a file, so the editor's first read comes after delivery. A run that clears the video URL
 * remounts the editor, which may reuse the cached script; whoever starts such a run reads it
 * again (as an editor render does, in useLongTakeExport).
 *
 * `delivered` is undefined while the stage is unknown, false while the video is not delivered
 * (still generating) and true once it is. Only false then true reads again, so opening a
 * delivered video reads nothing twice.
 */
export function useReadVideoScriptOnDelivery(projectId: string, delivered: boolean | undefined) {
  const queryClient = useQueryClient()
  // The project seen generating, until its video is delivered.
  const generating = useRef<null | string>(null)
  useEffect(() => {
    if (!projectId) {
      return
    }
    if (delivered === false) {
      generating.current = projectId
      return
    }
    if (delivered && generating.current === projectId) {
      generating.current = null
      void queryClient.invalidateQueries({ queryKey: videoScriptQueryKey(projectId) })
    }
  }, [delivered, projectId, queryClient])
}
