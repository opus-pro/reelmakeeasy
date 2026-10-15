import type { ActiveModalKind } from '@reelmakeeasy/common/uip/active-modal-kind'
import type { Fetcher } from '@reelmakeeasy/common/utils/fetcher'
import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'
import type { AspectRatio } from '@shared/types/api/project'
import { atomWithDefault } from 'jotai/utils'

import { createAtom, createNullableAtom } from '@/lib/jotai-atom-utils'

import { getAdapterSessionAtom, getAdapterSessionIdAtom } from '../../adapter/adapter-atoms'
import type { UploadedAsset } from '../../adapter/api-types'
import { createEmptyPlannerRenderState } from '../../defaults'
import type {
  BrandBriefDraft,
  BrandSelectedSavedStyle,
  PlannerFatalError,
  RenderState,
  SummaryDraft,
} from '../../state-types'
import type { PlannerApi } from '../planner-api'

export interface DraftFileUpload {
  blobUrl: string
  fetcher: Fetcher<UploadedAsset>
  file: File
  id: string
}

export interface VoiceoverTtsTake {
  audioUrl: string
  /** Length the API measured for these bytes. */
  durationSeconds: number
  /** Params these bytes were rendered from; a drift means this take is superseded. */
  signature: string
}

export const getApiAtom = createWeakMapFn(() =>
  createNullableAtom<PlannerApi>('storyModeUip/deps/api'),
)

// Project ids whose auto-style candidates_impression has already fired. Lives in
// the (session-scoped) store, not a component ref, so it survives the card
// unmounting/remounting -- e.g. when a canvas edit modal swaps out ArtifactPanel
// -- and never double-counts one project's impression.
export const getFiredStyleImpressionProjectIdsAtom = createWeakMapFn(() =>
  createAtom<Set<string>>(new Set<string>(), 'storyModeUip/atom/firedStyleImpressionProjectIds'),
)

/**
 * How many TTS syntheses are in flight for this session, published by useTranscriptAudioGeneration so
 * the canvas rail can report the Voiceover row as generating instead of done.
 *
 * A count, not a flag: SessionVoiceoverTtsOwner and the voiceover edit modal's editor each mount a
 * generator, and either can start a synthesis -- the owner unattended, the editor on a Generate
 * click. A flag would let whichever instance mounted last clear a synthesis the other still has
 * running. Display-only -- no request is gated on it, so a leaked increment costs a spinner, never
 * audio. What keeps the two from *duplicating* a synthesis is the guards below, not this.
 */
export const getVoiceoverTtsGeneratingCountAtom = createWeakMapFn(() =>
  createAtom(0, 'storyModeUip/atom/voiceoverTtsGeneratingCount'),
)

/**
 * Voiceover TTS is owned per session, not per component. These live in the session store
 * for the same reason getFiredStyleImpressionProjectIdsAtom does: a component ref dies when a canvas
 * edit modal swaps out ArtifactPanel, and two surfaces each holding their own ref is what let them
 * fire concurrent /transcript-voice-preview POSTs and race on the persisted take. In the store the
 * guards hold across every surface, so the dedupe is structural rather than a matter of which
 * surfaces happen to be mounted.
 *
 * Both are read and written synchronously via PlannerState.get/set, never useAtomValue -- a
 * render-time snapshot is stale in exactly the tick that matters for a guard.
 */

/**
 * The signatures currently being synthesized for this session.
 *
 * Signatures, not a flag, because the two callers ask different questions. An unattended synthesis
 * asks "is anything running" and stands down if so; a Generate click asks "is *this* audio already
 * coming", and a click that lands while another surface renders different params is a deliberate
 * request that has to go through -- a flag turned it into a no-op with no feedback of any kind.
 *
 * A list, not one signature, because allowing that click admits two concurrent syntheses. A single
 * slot would let the second overwrite the first's claim, and whichever finished first would then
 * clear the guard for the one still running.
 */
export const getVoiceoverTtsInFlightSignaturesAtom = createWeakMapFn(() =>
  createAtom<string[]>([], 'storyModeUip/atom/voiceoverTtsInFlightSignatures'),
)

/**
 * Signatures auto-generate has already started this session, so no surface re-fires for params some
 * other surface already covered.
 *
 * A list rather than the last one written: the owner synthesizes the *saved* narration while the
 * refinement editor synthesizes the live draft, so the two legitimately hold different signatures at
 * once. With a single slot each write disarmed the other, and a later re-render re-fired a paid
 * synthesis the other surface had already completed.
 *
 * Bounded because an editor in refinement mints a signature per keystroke. The cap only has to
 * exceed the number of surfaces that can disagree at one time -- two -- so the oldest entries are
 * free to fall off; the worst a dropped entry costs is one repeated synthesis.
 */
export const getVoiceoverTtsAttemptedSignaturesAtom = createWeakMapFn(() =>
  createAtom<string[]>([], 'storyModeUip/atom/voiceoverTtsAttemptedSignatures'),
)

export const VOICEOVER_TTS_ATTEMPTED_SIGNATURES_MAX = 20

/**
 * Bumped when a reader asks for another attempt at params that already failed, and read
 * by the generation hook as an auto-generate input.
 *
 * Withdrawing the attempted signature above is not enough on its own: the auto-generate effect reads
 * that list imperatively, so nothing re-runs it while the voice, speed, and narration all sit still
 * -- which is exactly the case a retry addresses. This counter is the one input that is guaranteed to
 * have moved, so it is what re-runs the effect.
 */
export const getVoiceoverTtsRetryNonceAtom = createWeakMapFn(() =>
  createAtom(0, 'storyModeUip/atom/voiceoverTtsRetryNonce'),
)

/**
 * The freshest take generated in this tab, published for any surface to play. Preferred over the
 * session's persisted take while it still matches the live params: these bytes are in hand, while
 * the CDN object the API just wrote may not be readable yet.
 */
export const getVoiceoverTtsTakeAtom = createWeakMapFn(() =>
  createNullableAtom<VoiceoverTtsTake>('storyModeUip/atom/voiceoverTtsTake'),
)

/**
 * Why the session's last unattended TTS attempt failed, or null. Published by the owner so the
 * canvas can say so: it does not retry a signature it has already attempted, so a failure that goes
 * unsurfaced leaves the artifact silently without a player.
 *
 * Reads as "the last attempt failed", not "the current params failed" -- the underlying hook clears
 * its error at the start of each attempt, and a param change almost always triggers one.
 */
export const getVoiceoverTtsErrorAtom = createWeakMapFn(() =>
  createNullableAtom<string>('storyModeUip/atom/voiceoverTtsError'),
)

/**
 * Whether SessionVoiceoverTtsOwner is mounted for this session -- i.e. whether anything will run the
 * group revoke below. A planner store existing is not the same fact: the legacy planner dialog
 * provides one for every flag-off user, and no owner mounts there. Instances hand their blobs over
 * only when this is true; otherwise they keep releasing their own, as they always have.
 */
export const getVoiceoverTtsOwnerMountedAtom = createWeakMapFn(() =>
  createAtom(false, 'storyModeUip/atom/voiceoverTtsOwnerMounted'),
)

/**
 * Every object URL this session has minted for a take, so they can be released together.
 *
 * Revoking one the moment it is superseded is not safe: a take is shared, and a surface that is
 * mid-playback keeps its own reference until its replacement lands, so an eager revoke leaves that
 * player on a dead URL. Nor is there a per-URL release signal to wait for. Instead the whole set is
 * revoked when the session's TTS owner unmounts -- by then the canvas is gone, and with it every
 * surface that could still be holding one.
 */
export const getVoiceoverTtsBlobUrlsAtom = createWeakMapFn(() =>
  createAtom<string[]>([], 'storyModeUip/atom/voiceoverTtsBlobUrls'),
)

export const getDraftFileUploadsAtom = createWeakMapFn(() =>
  createAtom<DraftFileUpload[]>([], 'storyModeUip/atom/draftFileUploads'),
)

export const getDraftMessageAtom = createWeakMapFn(() =>
  createAtom('', 'storyModeUip/atom/draftMessage'),
)

// Client-only "the user just hit send" flag. Set synchronously on submit so the
// "Thinking..." indicator paints immediately -- before the optimistic echo, the
// session load, or any backend signal. Cleared once a backend update reflects the
// turn (is_processing / assistant reply / inactive) or on send failure. Covers the
// cold-first-message gap the session-sync pending-tail term can't reach.
export const getSubmitPendingAtom = createWeakMapFn(() =>
  createAtom(false, 'storyModeUip/atom/submitPending'),
)

// Client-only record of which running tool calls the user has already asked to
// stop, keyed by `${toolCallId}@${startedAt}` so a later re-run of the
// same tool is a different key. Drives the composer's disabled "stopping" state
// between the click and the workflow's `tool_cancelled` landing over SSE. Needs no
// cleanup: the keys only ever match tool calls that are still running.
export const getStopRequestedToolCallKeysAtom = createWeakMapFn(() =>
  createAtom<string[]>([], 'storyModeUip/atom/stopRequestedToolCallKeys'),
)

export const getLatestScriptReviewSaveFetcherAtom = createWeakMapFn(() =>
  createNullableAtom<Fetcher<boolean>>('storyModeUip/deps/latestScriptReviewSaveFetcher'),
)

export const getPendingVoicePreviewSettingsSavePromisesAtom = createWeakMapFn(() =>
  createAtom<Promise<void>[]>([], 'storyModeUip/deps/pendingVoicePreviewSettingsSavePromises'),
)

export const getRenderStateAtom = createWeakMapFn(() =>
  createAtom<RenderState>(createEmptyPlannerRenderState(), 'storyModeUip/deps/renderState'),
)

export const getIsConfirmingScriptReviewGateAtom = createWeakMapFn(() =>
  createAtom(false, 'storyModeUip/ui/isConfirmingScriptReviewGate'),
)

/** An open storyboard confirm-handoff window. `openedAt` is the stall deadline's
 * origin, stamped once per attempt. */
export interface StoryboardHandoff {
  openedAt: number
  sessionId: string
}

// The open storyboard confirm-handoff window, or null (useStoryboardChecklist explains
// why the window is latched). In the store rather than in hook state for two reasons: the reset is
// produced OUTSIDE React -- only planner-api-factory's continueDraft knows a confirm was rejected,
// and a rejection is indistinguishable from the normal path from RenderState's side -- and both
// the section and the rail derive from it, so one shared deadline beats a timer per caller. Keyed
// by session id so a PlannerState that outlives its session cannot carry a window into the next.
export const getStoryboardHandoffAtom = createWeakMapFn(() =>
  createNullableAtom<StoryboardHandoff>('storyModeUip/ui/storyboardHandoff'),
)

export const getVoiceoverSpeedAtom = createWeakMapFn((scope) => {
  // Confirmation can run before the voice editor mounts and hydrates its draft.
  // Read the saved speed until the editor explicitly writes a local value.
  const a = atomWithDefault((get) => {
    const sessionId = get(getAdapterSessionIdAtom(scope))
    const session = get(getAdapterSessionAtom(scope))
    const state = !sessionId || session?.session_id === sessionId ? session?.state : undefined
    const speed = state?.voice_preview_speed ?? state?.preview_voiceover?.speed ?? 1
    return Number.isFinite(speed) ? Number(Math.min(2, Math.max(0.5, speed)).toFixed(2)) : 1
  })
  a.debugLabel = 'storyModeUip/ui/voiceoverSpeed'
  return a
})

// True while the canvas Voiceover section has playable audio. Published by VoiceoverPlayer (the only
// component that renders when audio exists) so the Script section hides its word-count "Est. duration"
// once the real voiceover's actual duration is shown. Client-only: TTS audio isn't
// persisted, so this resets on reload and the estimate returns until it regenerates.
export const getCanvasVoiceoverHasAudioAtom = createWeakMapFn(() =>
  createAtom(false, 'storyModeUip/ui/canvasVoiceoverHasAudio'),
)

export const getPlannerFatalErrorAtom = createWeakMapFn(() =>
  createNullableAtom<PlannerFatalError>('storyModeUip/ui/fatalError'),
)

/**
 * Which canvas artifact modal is currently open, if any (unifying
 * getScriptEditModalAtom / getStoryboardEditModalAtom / getVoiceoverEditModalAtom /
 * getBrandBriefModalAtom / the former shadow-tracking getActiveModalAtom into one
 * discriminated union). Mutual exclusivity is now structural: only one variant can
 * be assigned at a time. `brand-create` carries `mode` because it determines which
 * submission payload shape (`{kind: 'url', url}` vs `{kind: 'freeform', text,
 * uploadedAssets}`) submitQuickOption builds downstream. Client-only state: not
 * persisted, not sent to the backend.
 */
export type ActiveModal =
  | null
  | { kind: 'assets' }
  | { kind: 'brand-create'; mode: 'freeform' | 'url' }
  | { kind: 'script' }
  | { kind: 'storyboard' }
  | { kind: 'summary' }
  | { kind: 'video' }
  | { kind: 'voiceover' }

export type { ActiveModalKind }

// Compile-time guard: keeps ActiveModal's kind union in sync with the shared
// SOT (see @reelmakeeasy/common/uip/active-modal-kind's docblock) -- catches drift as
// a type error.
const _assertModalKindsInSync: [NonNullable<ActiveModal>['kind']] extends [ActiveModalKind]
  ? [ActiveModalKind] extends [NonNullable<ActiveModal>['kind']]
    ? true
    : never
  : never = true

export const getActiveModalAtom = createWeakMapFn(() =>
  createNullableAtom<ActiveModal>('storyModeUip/ui/activeModal'),
)

// Id of the video_brief_card version being viewed read-only in the Edit Summary history
// popover; null = showing the current version. No editable draft or Restore (view-only),
// so this id is the whole history view state.
export const getSummaryVersionPreviewAtom = createWeakMapFn(() =>
  createNullableAtom<string>('storyModeUip/ui/summaryVersionPreview'),
)

export const getPlannerScopeElementAtom = createWeakMapFn(() =>
  createAtom<HTMLElement | null>(null, 'storyModeUip/ui/plannerScopeElement'),
)

export const getScrollInnerElementAtom = createWeakMapFn(() =>
  createAtom<HTMLElement | null>(null, 'storyModeUip/ui/scrollInnerElement'),
)

export const getOutputVideoAtom = createWeakMapFn(() =>
  createNullableAtom<string>('storyModeUip/ui/outputVideo'),
)

export const getVideoThumbnailAtom = createWeakMapFn(() =>
  createNullableAtom<string>('storyModeUip/ui/videoThumbnail'),
)

// The project's configured output ratio, known long before the render finishes, so the canvas video
// section can reserve its box and paint the poster instead of collapsing until the video's own
// loadedmetadata fires. Deliberately not gated on isVideoReady.
export const getVideoAspectRatioAtom = createWeakMapFn(() =>
  createNullableAtom<AspectRatio>('storyModeUip/ui/videoAspectRatio'),
)

export const getIsVideoReadyAtom = createWeakMapFn(() =>
  createAtom(false, 'storyModeUip/ui/isVideoReady'),
)

export const getProjectIdAtom = createWeakMapFn(() =>
  createNullableAtom<string>('storyModeUip/ui/projectId'),
)

export const getBrandBriefDraftAtom = createWeakMapFn(() =>
  createNullableAtom<BrandBriefDraft>('storyModeUip/brand/briefDraft'),
)

// Id of the brand_brief_card version being viewed read-only in the
// uid_revamp canvas Brand section's History popover. Kept separate from the
// draft atom so a preview never enters the editable/commit path. null = not
// previewing (the live current version is shown).
export const getBrandVersionPreviewAtom = createWeakMapFn(() =>
  createNullableAtom<string>('storyModeUip/brand/versionPreview'),
)

// The saved-brand style the user picked in the brand-review.
// confirmBrandReview reads it to apply that style as the hybrid look. Null
// unless a reused saved brief exposed its own styles and one is selected.
export const getBrandSelectedSavedStyleAtom = createWeakMapFn(() =>
  createNullableAtom<BrandSelectedSavedStyle>('storyModeUip/brand/selectedSavedStyle'),
)

// Snapshot of the current brand_bank's staged_assets, published by
// BrandBriefCardBlockItem alongside the draft. buildBrandBankEdits reads
// this to diff user_upload refs that the user removed from the draft and
// emit remove_asset ops for them.
export const getBrandBriefBankAssetsAtom = createWeakMapFn(() =>
  createNullableAtom<unknown>('storyModeUip/brand/briefBankAssets'),
)

// In-flight finalize promises for brand-card uploads. enqueueAndFlush
// and confirmBrandReview await these before snapshotting the draft so a
// chat message sent mid-upload still includes the add_asset edit (the
// upload's file_path is only known after the storage PUT resolves).
export const getBrandPendingUploadsAtom = createWeakMapFn(() =>
  createAtom<Map<string, Promise<void>>>(new Map(), 'storyModeUip/brand/pendingUploads'),
)

// True once the user has typed anything into the brand-brief card. Drives
// (a) the BrandBriefCardBlockItem's re-hydration guard so server pushes
// don't clobber local edits, and (b) the send-queue's decision to flush
// the draft alongside chat messages. Reset to false after a successful
// flush (the local draft is now == server truth) and on block id change.
export const getBrandBriefDraftEditedAtom = createWeakMapFn(() =>
  createAtom(false, 'storyModeUip/brand/briefDraftEdited'),
)

export const getBrandBriefSubmittedAtom = createWeakMapFn(() =>
  createAtom(false, 'storyModeUip/brand/briefSubmitted'),
)

// Published by VideoBriefCardBlockItem when editable=true, mirroring
// getBrandBriefDraftAtom -- Task 3's send/adapter step reads this to diff against the
// block and build a SummaryFieldEdit payload.
export const getSummaryDraftAtom = createWeakMapFn(() =>
  createNullableAtom<SummaryDraft>('storyModeUip/summary/draft'),
)

// True once the user has typed anything into the editable Summary card. Mirrors
// getBrandBriefDraftEditedAtom -- drives VideoBriefCardBlockItem's re-hydration guard so
// incoming block prop changes don't clobber local edits.
export const getSummaryDraftEditedAtom = createWeakMapFn(() =>
  createAtom(false, 'storyModeUip/summary/draftEdited'),
)

// Last-committed (or freshly seeded) Summary draft. commitSummaryEdit diffs
// getSummaryDraftAtom against this to send only the fields the user actually
// changed -- otherwise every commit would resend the whole draft, including a
// description that's still showing the "No summary yet." placeholder text.
export const getSummaryDraftBaselineAtom = createWeakMapFn(() =>
  createNullableAtom<SummaryDraft>('storyModeUip/summary/draftBaseline'),
)

// The currently in-flight summary-save promise, or null when idle.
// commitSummaryEdit chains behind this so saves are serialized per planner --
// an older POST can never resolve and land after a newer one, which would
// otherwise revert the user's latest edit on the next SSE-pushed block.
export const getSummaryCommitChainAtom = createWeakMapFn(() =>
  createNullableAtom<Promise<void>>('storyModeUip/summary/commitChain'),
)

export const getOnVideoThumbnailClickAtom = createWeakMapFn(() =>
  createNullableAtom<() => void>('storyModeUip/ui/onVideoThumbnailClick'),
)

/**
 * Which arm rendered this planner, published by UipPlannerSection -- the one component both
 * routes mount, and the same source uip.surface.mounted reports from, so the two events join.
 * Stays null until UipPlannerSection publishes it: 'legacy' is also the right answer for a
 * real legacy visit, so an early read must not default to it.
 */
export const getGateSurfaceAtom = createWeakMapFn(() =>
  createNullableAtom<'canvas' | 'legacy'>('storyModeUip/ui/gateSurface'),
)
