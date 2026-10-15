import { type CameraStyle, DEFAULT_CAMERA_STYLE } from '@reelmakeeasy/common/long-take/camera-craft'
import { DEFAULT_MUSIC_CHOICE, type MusicRequest } from '@reelmakeeasy/common/long-take/music-craft'
import type { AspectRatio, ProjectVoiceOverJson } from '@shared/types/api/project'
import type { Attachment } from '@shared/types/assets/attachment'
import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { atom } from 'jotai'

import { atomWithPersistence } from './common'

// Payload for applying a quick start template via page-level callbacks/ref API.
export type ApplyQuickStartTemplatePayload = {
  attachments?: Attachment[]
  prompt: string
}

// Stores the quick start templates list
export const quickStartTemplatesAtom = atom<QuickStartTemplate[]>([])
quickStartTemplatesAtom.debugLabel = 'quick-start-templates-atom'

// Stores the deep link template (fetched via URL parameter, separate from paginated list)
export const quickStartDeepLinkTemplateAtom = atom<null | QuickStartTemplate>(null)
quickStartDeepLinkTemplateAtom.debugLabel = 'quick-start-deep-link-template-atom'

export const longTakeEnabledAtom = atom<boolean>(false)
longTakeEnabledAtom.debugLabel = 'long-take-enabled-atom'

/**
 * What a creation gets when the user has never said otherwise: BGM
 * reviewed well, so a video comes with music. Surfaces that render no BGM
 * control opt out of this default instead of charging for a bed the user could
 * not decline -- see musicEnabledExplicitAtom.
 */
export const DEFAULT_MUSIC_ENABLED = true

// The user's remembered "Background music" choice, or null when they have never
// made one. Persisted (mirroring selectedRatioAtom) so the last explicit pick is
// the next default: as a plain in-memory atom the toggle reset on every
// full-document load, so a choice only held until the next reload. Only the
// toggle writes here (musicPreferenceAtom), which is what lets a remembered OFF
// outrank the default -- someone who wants silent videos stays silent. The null
// is what keeps "chose ON" distinguishable from "never chose".
const persistedMusicEnabledAtom = atomWithPersistence<boolean | null>('bgm:enabled', null, {
  preload: false,
})
persistedMusicEnabledAtom.debugLabel = 'music-enabled-persisted-atom'

// Composition-scoped override, written by the remix carry. null =>
// follow the remembered preference. Deliberately in-memory: it describes the
// composition being built, not the user, so a remix seeded from its SOURCE
// project can neither become a standing default nor erase a remembered choice.
const musicEnabledOverrideAtom = atom<boolean | null>(null)
musicEnabledOverrideAtom.debugLabel = 'music-enabled-override-atom'

/**
 * What the submission box shows and what creation submits.
 *
 * Writing `null` drops the composition-scoped value and falls back to the
 * remembered preference -- how a composition that is not a remix sheds a
 * previous remix's carried value (useRemixBgmCarry). Without it the override
 * would outlive its composition for the whole SPA session.
 */
export const musicEnabledAtom = atom(
  (get) => get(musicEnabledOverrideAtom) ?? get(persistedMusicEnabledAtom) ?? DEFAULT_MUSIC_ENABLED,
  (_get, set, enabled: boolean | null) => {
    set(musicEnabledOverrideAtom, enabled)
  },
)
musicEnabledAtom.debugLabel = 'music-enabled-atom'

/**
 * Whether musicEnabledAtom reflects actual intent rather than the default: an
 * explicit toggle (remembered) or a remix carry (this composition). Surfaces
 * with no BGM control read this to submit off unless the user really asked for
 * music -- a default they cannot see must not add a bed they did not ask for.
 */
export const musicEnabledExplicitAtom = atom(
  (get) => get(musicEnabledOverrideAtom) !== null || get(persistedMusicEnabledAtom) !== null,
)
musicEnabledExplicitAtom.debugLabel = 'music-enabled-explicit-atom'

/** The submission-box toggle: remember the choice, and apply it to this box. */
export const musicPreferenceAtom = atom(null, (_get, set, enabled: boolean) => {
  set(persistedMusicEnabledAtom, enabled)
  set(musicEnabledOverrideAtom, enabled)
})
musicPreferenceAtom.debugLabel = 'music-preference-atom'

// Story-mode aspect-ratio pick. Persisted (mirroring persistedMusicEnabledAtom) rather than
// component-local so it survives an OmniChatBox remount -- the box is force-
// remounted via key={selectedUseCaseKey} on use-case switch, and a guest->login
// round-trip. As ephemeral useState the 16:9 pick silently reset to 9:16 before
// the create-session submit, so the project rendered 9:16.
export const selectedRatioAtom = atomWithPersistence<AspectRatio>(
  'aspect-ratio:selection',
  '9:16',
  {
    preload: false,
  },
)
selectedRatioAtom.debugLabel = 'selected-ratio-atom'

/**
 * Story-mode video quality: the resolution transition clips are generated at.
 * Persisted like the aspect ratio. 768p is the default on fal; Gemini clips
 * are 720p or 1080p (see VideoQualityButton for prices).
 */
export type VideoQuality = '480p' | '720p' | '768p' | '1080p'
export const DEFAULT_VIDEO_QUALITY: VideoQuality = '768p'
export const videoQualityAtom = atomWithPersistence<VideoQuality>(
  'video-quality:selection',
  DEFAULT_VIDEO_QUALITY,
  { preload: false },
)
videoQualityAtom.debugLabel = 'video-quality-atom'

/**
 * The clip model picked in the composer when the generation provider offers a
 * choice (Gemini). Null means the provider's default; a key the provider does
 * not offer is ignored (video-choices.ts).
 */
export const videoModelChoiceAtom = atomWithPersistence<null | string>(
  'video-model:selection',
  null,
  { preload: false },
)
videoModelChoiceAtom.debugLabel = 'video-model-choice-atom'

/** Story-mode camera style: Calm (default) or Dynamic. Persisted like the video quality. */
export const cameraStyleAtom = atomWithPersistence<CameraStyle>(
  'camera-style:selection',
  DEFAULT_CAMERA_STYLE,
  { preload: false },
)
cameraStyleAtom.debugLabel = 'camera-style-atom'

/** Story-mode background music: a mood (Auto by default), the user's words, a library or
 *  own track, or Off. Persisted like the camera style; read it through `sanitizeMusicRequest`. */
export const musicRequestAtom = atomWithPersistence<MusicRequest>(
  'music:request',
  { choice: DEFAULT_MUSIC_CHOICE },
  { preload: false },
)
musicRequestAtom.debugLabel = 'music-request-atom'

// Triggers insertion of LongTakeNode into the editor
export const insertLongTakeAtom = atom<number>(0)
insertLongTakeAtom.debugLabel = 'insert-long-take-atom'

// Payload for applying a Long Take template from external entry points.
export type ApplyLongTakeTemplatePayload = {
  aspectRatio?: AspectRatio
  attachments?: Attachment[]
  audioUrl?: string
  // Source project had BGM on. Producers emit only literal `true`
  // (off/unknown sources omit the field so non-BGM payloads stay byte-identical).
  bgmEnabled?: boolean
  isStyleCopy?: boolean
  previewUrl?: string
  remixProjectId?: string
  script?: string
  // Share id of the /share/[shareId] page a remix started from, so the late
  // carry-context fetch can view a non-owned source the same way the remix
  // guard's fetch does. Absent on owned-project and demo remixes.
  shareId?: string
  sourceVoice?: ProjectVoiceOverJson
  styleName?: string
  styleText?: string
  styleThumbnailUrl?: string
  userPrompt?: string
}

// Pending "use this style" payload set directly from same-page card actions.
// Bypasses URL-transfer (which only fires once per mount) for in-page navigation.
export const pendingUseThisStyleAtom = atom<ApplyLongTakeTemplatePayload | null>(null)
pendingUseThisStyleAtom.debugLabel = 'pending-use-this-style-atom'

// Pending "remix" payload set directly from same-page card actions.
export const pendingRemixAtom = atom<ApplyLongTakeTemplatePayload | null>(null)
pendingRemixAtom.debugLabel = 'pending-remix-atom'

export const pendingSourceVoiceAtom = atom<null | ProjectVoiceOverJson>(null)
pendingSourceVoiceAtom.debugLabel = 'pending-source-voice-atom'

// Carried BGM-on intent from a remix apply. Source-bound: the
// reconciler consumes it only while the composer's active remixProjectId still
// matches, and clears it on mismatch, so stale intent can never leak into an
// unrelated composition. Reset at the top of every applyLongTakeTemplate.
export const pendingRemixBgmAtom = atom<null | { sourceProjectId: string }>(null)
pendingRemixBgmAtom.debugLabel = 'pending-remix-bgm-atom'

export const confirmCardDialogOpenAtom = atom<boolean>(false)
confirmCardDialogOpenAtom.debugLabel = 'confirm-card-dialog-open-atom'

// Chat box mode for enhance review flow
export type ChatBoxMode = 'edit' | 'enhance-review'

export const chatBoxModeAtom = atom<ChatBoxMode>('edit')
chatBoxModeAtom.debugLabel = 'chat-box-mode-atom'
