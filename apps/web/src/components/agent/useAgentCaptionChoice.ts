'use client'

import { atom, useAtomValue, useSetAtom } from 'jotai'
import { useCallback } from 'react'

import { captionPreferencesAtom } from '@/atom/longtake-history.store'

const setProjectCaptionPreferenceAtom = atom(
  null,
  (get, set, { next, projectId }: { next: boolean; projectId: string }) => {
    set(captionPreferencesAtom, { ...get(captionPreferencesAtom), [projectId]: next })
  },
)

/**
 * A project's caption choice, resolved the way the Story Mode editor resolves its
 * caption switch (`nextCaptionRenderSettings`): the per-project preference persisted on
 * this device when there is one, else what the delivered video has. Changing it writes
 * that same preference, so the editor opens with the same choice.
 *
 * Kept per project here, not in the editor's single-project `renderSettingsAtom`: the
 * agent page can show several videos.
 *
 * `captionsOn` is null until the status says whether the video has captions.
 */
export function useAgentCaptionChoice(projectId: string, captionsInVideo: boolean | null) {
  const preferences = useAtomValue(captionPreferencesAtom)
  const setPreference = useSetAtom(setProjectCaptionPreferenceAtom)
  const captionsOn: boolean | null = preferences[projectId] ?? captionsInVideo
  const setCaptionsOn = useCallback(
    (next: boolean) => setPreference({ next, projectId }),
    [projectId, setPreference],
  )
  return { captionsOn, setCaptionsOn }
}
