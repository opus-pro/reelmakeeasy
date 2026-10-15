'use client'
import { cn, ExternalImage, toast, Tooltip } from '@shared/ui'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MagicEdit } from '@/components/icons/core'
import { recordSavedStyleUse } from '@/components/omni-chat-box-v2/record-saved-style-use'
import { BackdropDialog } from '@/components/omni-chat-box-v2/shared/BackdropDialog'
import { ChooseStylePopup } from '@/components/omni-chat-box-v2/style/ChooseStylePopup'
import { useApi } from '@/hooks/useApi'
import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'
import { useStoryModeStyleOptions } from '@/hooks/useStoryModeConfig'
import { latestScenePreviewUrls, useUserSavedStyles } from '@/hooks/useUserSavedStyles'

import { getAdapterSessionAtom } from '../adapter/adapter-atoms'
import type { StyleCandidate } from '../adapter/api-types'
import { FONT_FEATURE_SETTINGS } from '../defaults'
import { switchStyle } from '../state/actions/flow-actions'
import { getFiredStyleImpressionProjectIdsAtom } from '../state/atoms/planner'
import { usePlannerState } from '../state/planner-context'
import type { StyleCandidatesBlock } from '../state-types'

const LABEL_CLASSES = 'text-xs font-medium uppercase tracking-wider text-primary/50'

// Agent-voice hint above the rail: explains that these three are a
// director-picked shortlist, not the full catalog, so the three-card rail reads
// as a recommendation rather than the only choices. Kept as a constant so the
// copy is easy to tweak.
const STYLE_RAIL_AGENT_HINT = 'I picked the three styles that best fit your story.'

// Shown when a style switch couldn't apply because the session crossed the
// visual-render lock before it landed. setStyle can be silently
// dropped at that boundary while the API still returned success, so surface
// the truth instead of leaving a permanently-wrong highlight.
const STYLE_LOCKED_TOAST = "Rendering already started — your style change didn't apply."

// Shown when an auto-style re-run replaced a style the user had picked themselves.
// A topic change re-runs the pick unconditionally (a deliberate product decision), so
// the swap is announced rather than left to be noticed.
const STYLE_RERUN_NOTICE = 'Style updated to match your new topic.'

// Fire the impression once the card is actually >=50% on screen, not on
// render -- the switch-away rate (auto_switched on project.long_take.completed)
// needs a denominator of "candidates the user could plausibly have seen," which
// render alone doesn't guarantee (e.g. below the fold).
const IMPRESSION_THRESHOLD = 0.5

// Coalesce rapid taps: the highlight moves optimistically on every tap, but the
// setStyle signal -> spec_patched -> publish cycle is only sent for the settled
// pick this long after the last tap. Comparing several options fires ONE request,
// not one per tap. Kept short so a pick immediately followed by a script-confirm
// still flushes in time before the visual-render lock.
const STYLE_SEND_DEBOUNCE_MS = 500

interface StyleCandidateCardProps {
  candidate: StyleCandidate
  disabled: boolean
  onSelect: (candidate: StyleCandidate) => void
  selected: boolean
  // The AI-pick icon/tooltip marks the three rail recommendations; the 4th
  // off-rail card (a "View more" pick) never gets it, since the AI didn't
  // recommend it.
  showAiPickIcon: boolean
}

interface StyleCandidatesBlockItemProps {
  block: StyleCandidatesBlock
}

// Auto Style Selection candidates rail. Mirrors the visual
// language of BrandStylesPicker's card grid, but each tap applies the style
// immediately via switchStyle rather than staging a local pick for later confirm --
// the two pickers serve different flows (brand-review style pick vs. mid-session
// auto-style override) so they intentionally don't share the same component.
//
// Memoized (custom comparator on the block's meaningful fields): renderState.blocks
// is rebuilt on every SSE tick, so without this the whole rail + all cards re-render
// on unrelated updates (script streaming, etc.). Selection responsiveness comes from
// the OPTIMISTIC local highlight below, not from waiting on the server round-trip.
function StyleCandidatesBlockItemInner({ block }: StyleCandidatesBlockItemProps) {
  const state = usePlannerState()
  // Optimistic selection: set synchronously on click so the highlight moves
  // instantly, before the setStyle signal -> spec_patched -> publish -> SSE round
  // trip lands. Cleared once the server-applied style catches up (or the pick is
  // no longer offered / the switch failed).
  const [pendingStyleName, setPendingStyleName] = useState<null | string>(null)
  // Saved styles can share a display name, while the picker identifies them by
  // persisted UUID. Keep that identity alongside the name used by setStyle so
  // reopening View more highlights the exact style the user selected.
  const [selectedUserStyleId, setSelectedUserStyleId] = useState<null | string>(null)
  // A "View more" pick outside the three rail candidates renders as a 4th card
  // (per the design) instead of the rail silently highlighting nothing.
  // Cleared whenever the pick lands back on one of the rail's own three.
  const [offRailCandidate, setOffRailCandidate] = useState<null | StyleCandidate>(null)
  const appliedSelectedName = resolveSelectedStyleName(block)
  const selectedName = pendingStyleName ?? appliedSelectedName
  // Identity of the current candidate set. The optimistic pick is only dropped
  // once this key changes (a genuine regen replaced the candidates) -- not merely
  // because the pick isn't in the current three. That keeps an off-list "View
  // more" choice optimistic through its in-flight request instead of flashing the
  // stale server-applied rail card while it lands.
  // Join on a newline, which cannot appear in a style_name (catalog slug), so two
  // different candidate sets can never collapse to the same key (a space could,
  // if an id ever contained one -- that would freeze the pending-pick clear).
  const candidateSetKey = block.candidates.map((c) => c.style_name).join('\n')
  const pendingCandidateSetKeyRef = useRef<null | string>(null)
  // The style_name the user deliberately picked since the last candidate-set
  // change, or null if they haven't. A ref, not state: it must not trigger a
  // render, and the replacement effect below reads and clears it in the same
  // pass. Storing the NAME (not a boolean) lets that effect tell an override
  // (the applied style moved off this pick) apart from a re-rank that landed
  // back on the same style the user already had -- see handleSelect /
  // handlePickPreset for where this is set.
  const userPickedStyleNameRef = useRef<null | string>(null)
  const [showRerunNotice, setShowRerunNotice] = useState(false)
  // The candidate set this component has already accounted for. Distinguishes the
  // first set (nothing to announce) from a genuine replacement.
  const seenCandidateSetKeyRef = useRef<null | string>(null)
  // The project this component has already accounted for. `projectId` can change
  // under a mounted instance (see its declaration below for the exact chain, and
  // for why that is defensive rather than routine), so a fresh project's first
  // candidate set must reset the replacement-detection state instead of being
  // read as a replacement within the PREVIOUS project.
  const seenProjectIdRef = useRef<null | string>(null)
  // "View more" -> full preset catalog. useStoryModeStyleOptions reads the bundled
  // presets/story-mode/styles.json catalog -- the SAME list the backend ranks from
  // (session.spec.meta.style_catalog), so preset ids line up with candidate
  // style_names and with what setStyle expects.
  const [isAllStylesOpen, setIsAllStylesOpen] = useState(false)
  const { fetchApiDomain } = useApi()
  const allPresets = useStoryModeStyleOptions()
  const { styles: userSavedStyles } = useUserSavedStyles()
  const userStyleOptions = useMemo<StoryModeStyleOption[]>(
    () =>
      userSavedStyles.map((style) => {
        const scenePreviewUrls = latestScenePreviewUrls(style)
        return {
          id: style.id,
          label: style.name,
          scenePreviewUrls,
          styleText: style.generationStyleText?.trim() || style.styleText,
          thumbnailUrl: scenePreviewUrls.find((url) => url.trim()) || style.thumbnailUrl || '',
        }
      }),
    [userSavedStyles],
  )
  const userStyleIds = useMemo(
    () => new Set(userStyleOptions.map((style) => style.id)),
    [userStyleOptions],
  )
  const containerRef = useRef<HTMLDivElement>(null)
  // Reactive (not ref-read) on purpose: this id can change UNDER a mounted
  // instance, so the effects below must re-run when it does. The chain is
  // useProjects' projectIdAtom/projectAtom (module-global, shared across mounts)
  // -> UipPlannerSection's projectId prop -> useInitSession, whose effect
  // re-initializes the SAME plannerState in place on a projectId change rather
  // than remounting -- and this card would survive that anyway, since
  // build-blocks.ts gives the block a hardcoded id and TimelineList keys the
  // wrapper on it.
  //
  // Treat the in-place change as DEFENSIVE, not routine: every known entry into
  // a project page is a route change from elsewhere (the /projects list, a
  // project card, an admin report), and leaving /projects/[projectId] unmounts
  // the planner -- UipPlannerSection's own trackedSurfaceProjectIds comment says
  // as much. No in-page "switch to another project" affordance exists today. The
  // guard costs a few lines and the alternative is silently corrupting the
  // candidates_replaced metric if one is ever added.
  const projectId = state.useValue(getAdapterSessionAtom)?.session_id ?? ''

  // Debounced backend commit (declared before the reconcile effect, which
  // cancels a queued send when the render lock engages). The tap sets the
  // optimistic highlight (instant); the actual switchStyle is scheduled
  // STYLE_SEND_DEBOUNCE_MS after the LAST tap so rapid comparison taps collapse
  // to one request for the pick the user settles on. Cleared on unmount so a
  // pending send never fires after the card is gone.
  const sendTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null)
  const pendingSendRef = useRef<null | StyleCandidate>(null)

  useEffect(
    () => () => {
      if (sendTimerRef.current) {
        clearTimeout(sendTimerRef.current)
      }
    },
    [],
  )

  // Reconcile the optimistic pick. Keep it as the shown selection until a regen
  // replaces the candidate set and the pick is no longer offered. Deliberately do
  // NOT clear on server "confirmation" (appliedStyleName === pending): the applied
  // style arrives via SSE that can land out of order -- a slower in-flight publish
  // carrying the earlier applied value (the top-pick default) can arrive right
  // after the confirming one. Clearing on confirm would then unmask that stale
  // value for a frame, flickering the highlight back to the default before the
  // final value settles. Masking with the pending pick until regen avoids that;
  // an explicit switch failure still reverts it (see handleSelect).
  useEffect(() => {
    if (pendingStyleName == null) {
      return
    }
    // The visual-render lock engaged while our optimistic pick never applied:
    // a setStyle dropped at the lock boundary -- the API returns accepted:true
    // but the workflow discards the switch and emits no event to reconcile
    // against. `readOnly` is an ordering-safe fence, unlike any applied-based
    // unmask (see below): only post-lock folds carry readOnly=true, and the
    // style can no longer change after the lock, so a locked snapshot's
    // appliedStyleName is definitive -- a stale pre-lock echo has readOnly=false
    // and cannot trip this. Raw appliedStyleName (not the rail-resolved name)
    // so an off-rail pick that DID apply never false-warns. Also drop any
    // still-queued debounced send: it would be discarded anyway and its error
    // path would double-toast. Revert the highlight and tell the user -- a
    // permanently-wrong selection is worse than the truth.
    if (block.readOnly && block.appliedStyleName !== pendingStyleName) {
      if (sendTimerRef.current) {
        clearTimeout(sendTimerRef.current)
        sendTimerRef.current = null
      }
      pendingSendRef.current = null
      setPendingStyleName(null)
      setSelectedUserStyleId(null)
      setOffRailCandidate(null)
      toast.warning(STYLE_LOCKED_TOAST)
      return
    }
    const candidateSetAdvanced = pendingCandidateSetKeyRef.current !== candidateSetKey
    if (offRailCandidate == null) {
      // On-rail optimistic pick (a rail tap): a genuine regen that no longer
      // offers the pick means the rail changed under the user -> drop the
      // optimism. Deliberately NOT applied to an off-rail "View more" pick
      // below: that 4th card is a committed applied style, never one of the
      // rail's own three, so a candidate re-rank must not make it vanish.
      const stillOffered = block.candidates.some((c) => c.style_name === pendingStyleName)
      if (candidateSetAdvanced && !stillOffered) {
        setPendingStyleName(null)
        return
      }
    } else if (candidateSetAdvanced && block.appliedStyleName !== offRailCandidate.style_name) {
      // An auto-style re-run (a topic change re-picked the style) replaced the
      // candidate set AND moved the applied style off the user's "View more" pick.
      // The 4th card is now a superseded choice sitting unselected beside three
      // fresh recommendations, so retire it and unmask the server's new style.
      // Keyed on the applied style moving, not merely on the set advancing: a plain
      // re-rank that still has the user's pick applied must keep the card (below).
      setOffRailCandidate(null)
      setPendingStyleName(null)
      setSelectedUserStyleId(null)
      return
    } else if (block.candidates.some((c) => c.style_name === offRailCandidate.style_name)) {
      // A regen ranked the off-rail pick into the rail's own candidates: collapse
      // the 4th card back in rather than rendering the same style_name twice (a
      // duplicate React key, two "selected" cards, and a 5th tile in the 4-col grid).
      setOffRailCandidate(null)
    }
    // Deliberately NO "applied moved to a different value -> unmask" clause here.
    // A previous attempt (reverted) cleared the pick when appliedStyleName settled
    // on a value that was neither the pending pick nor the applied-at-pick-time
    // value. With two sequential picks, an out-of-order publish echoing the
    // ORIGINAL applied value (older than the last pick's baseline) passed that
    // guard and wiped the state: the off-rail 4th card vanished and the highlight
    // flicked to the first card before snapping back. Publishes replay old
    // applied values too freely for any applied-based unmask to be safe; masking
    // strictly until a regen replaces the candidate set is the only ordering-proof
    // rule.
  }, [
    block.appliedStyleName,
    block.candidates,
    block.readOnly,
    candidateSetKey,
    offRailCandidate,
    pendingStyleName,
  ])

  // A replaced candidate set means the runtime re-picked the style -- the once-per-brief
  // re-dispatch that a chat-driven topic change triggers. Track every replacement so the
  // rate is measurable, and announce/flag as an override only the ones where the
  // APPLIED style actually moved off a deliberate user pick (see
  // userPickedStyleNameRef) -- a re-rank that lands back on the user's own pick, or
  // whose style write got suppressed (auto-apply-runtime.ts, out of scope here), must
  // not be misreported as a swap.
  //
  // Guarded on `!projectId` (mirrors the impression effect below): on a client-side
  // project id change, useInitSession re-initializes the same planner state and only the
  // session atom populates at first, so this can otherwise run with an empty
  // project_id before it settles.
  useEffect(() => {
    if (!projectId) {
      return
    }
    const projectChanged =
      seenProjectIdRef.current != null && seenProjectIdRef.current !== projectId
    seenProjectIdRef.current = projectId
    if (projectChanged) {
      // An in-place project change lands as TWO renders, not one: the session
      // atom (and so `projectId`) changes first, while the block still carries
      // the PREVIOUS project's candidates -- `candidateSetKey` only catches up on
      // the render after. Resetting to null (not to this still-stale key) makes
      // the next render take the "previous == null" path below and record the new
      // project's first candidate set without emitting -- comparing against the
      // stale key here would misread it as a same-project replacement.
      //
      // NOTE: the regression test for this pins the single-render ordering, not
      // the two-render one -- this file's usePlannerState mock is non-reactive,
      // so nothing here can produce the intermediate render. Reverting the line
      // below to `= candidateSetKey` keeps the suite green. Pinning it properly
      // means driving the change through a real store, the way
      // StyleCandidatesBlockItem.impression.test.tsx already does.
      seenCandidateSetKeyRef.current = null
      userPickedStyleNameRef.current = null
      setSelectedUserStyleId(null)
      setShowRerunNotice(false)
      return
    }
    const previous = seenCandidateSetKeyRef.current
    seenCandidateSetKeyRef.current = candidateSetKey
    if (previous == null || previous === candidateSetKey) {
      return
    }
    const pickedStyleName = userPickedStyleNameRef.current
    userPickedStyleNameRef.current = null
    const replacedUserPick = pickedStyleName != null && pickedStyleName !== block.appliedStyleName
    if (replacedUserPick) {
      setShowRerunNotice(true)
    }
  }, [block.appliedStyleName, candidateSetKey, projectId])

  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof IntersectionObserver === 'undefined' || !projectId) {
      return
    }
    // One impression per PROJECT, deduped via session-scoped store state so it
    // survives the card unmounting/remounting (e.g. a canvas edit modal swapping
    // out ArtifactPanel). Skip entirely if this project already fired.
    if (state.get(getFiredStyleImpressionProjectIdsAtom).has(projectId)) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        // Require the threshold ratio explicitly: the observer's initial callback
        // can report isIntersecting=true at a ratio below `threshold`, which would
        // otherwise count a barely-visible card as a full impression.
        if (!entry?.isIntersecting || entry.intersectionRatio < IMPRESSION_THRESHOLD) {
          return
        }
        const fired = state.get(getFiredStyleImpressionProjectIdsAtom)
        if (fired.has(projectId)) {
          return
        }
        state.set(getFiredStyleImpressionProjectIdsAtom, new Set(fired).add(projectId))
        observer.disconnect()
      },
      { threshold: IMPRESSION_THRESHOLD },
    )
    observer.observe(node)

    return () => observer.disconnect()
  }, [projectId, state])

  // Stable across re-renders that don't change the applied style, so memoized
  // cards don't re-render on the optimistic-state flip (only the two whose
  // `selected` actually changed do).
  const handleSelect = useCallback(
    (candidate: StyleCandidate) => {
      userPickedStyleNameRef.current = candidate.style_name
      setSelectedUserStyleId(null)
      setShowRerunNotice(false)
      setPendingStyleName(candidate.style_name)
      // Once a 4th off-rail card is showing, it stays put (as an unselected
      // card) even if the user then taps back onto one of the rail's own
      // three -- only a genuinely new off-rail pick replaces it (see
      // handlePickPreset), so the rail doesn't flicker between 3 and 4 columns.
      pendingCandidateSetKeyRef.current = candidateSetKey
      pendingSendRef.current = candidate
      if (sendTimerRef.current) {
        clearTimeout(sendTimerRef.current)
      }
      sendTimerRef.current = setTimeout(() => {
        const target = pendingSendRef.current
        if (!target) {
          return
        }
        void switchStyle(state, target).then((ok) => {
          if (!ok) {
            // Revert the optimistic highlight back to the server-applied style.
            setPendingStyleName(null)
          }
        })
      }, STYLE_SEND_DEBOUNCE_MS)
    },
    [state, candidateSetKey],
  )

  const openAllStyles = useCallback(() => {
    setIsAllStylesOpen(true)
  }, [projectId])

  // The render below already drops the catalog the moment the rail turns read-only; this clears
  // the state behind it so the catalog cannot reappear on its own if `readOnly` ever goes back to
  // false. Nothing reopens it but the "View more" trigger, which is hidden while read-only.
  useEffect(() => {
    if (block.readOnly) {
      setIsAllStylesOpen(false)
    }
  }, [block.readOnly])

  // A pick from the full-catalog popup applies immediately (a deliberate single
  // choice, not the rapid comparison taps the rail debounces). The optimistic
  // highlight still moves so a picked style that IS one of the three rail tiles
  // reflects instantly; picks outside the top three simply apply server-side.
  const handlePickPreset = useCallback(
    (style: StoryModeStyleOption) => {
      if (block.readOnly) {
        return
      }
      const isUserStyle = userStyleIds.has(style.id)
      const styleName = isUserStyle ? style.label : style.id
      userPickedStyleNameRef.current = styleName
      setSelectedUserStyleId(isUserStyle ? style.id : null)
      setShowRerunNotice(false)
      // Cancel any debounced rail tap still queued: a rail tap schedules style A,
      // then a catalog pick applies style B now -- without this the stale timer
      // would later submit A and leave the project on the older choice.
      if (sendTimerRef.current) {
        clearTimeout(sendTimerRef.current)
        sendTimerRef.current = null
      }
      pendingSendRef.current = null

      setIsAllStylesOpen(false)
      const candidate: StyleCandidate = {
        is_top_pick: false,
        label: style.label,
        // Preset ids are their canonical style names. User-saved ids are UUIDs,
        // so persist the human-readable name while keeping the id only for the
        // picker tile identity.
        style_name: styleName,
        style_text: style.styleText ?? '',
        thumbnail_url:
          style.scenePreviewUrls?.find((url) => url.trim()) || style.thumbnailUrl || '',
      }
      // Off-rail picks (not one of the three shown) render as a 4th card
      // instead of leaving the rail without any highlighted selection. Once
      // showing, the 4th card stays put even if this pick lands back on one
      // of the rail's own three -- only a genuinely new off-rail pick
      // replaces its contents.
      const isOnRail = block.candidates.some((c) => c.style_name === styleName)
      if (!isOnRail) {
        setOffRailCandidate(candidate)
      }
      setPendingStyleName(styleName)
      pendingCandidateSetKeyRef.current = candidateSetKey
      void switchStyle(state, candidate).then((ok) => {
        if (!ok) {
          setPendingStyleName(null)
          setSelectedUserStyleId(null)
          setOffRailCandidate(null)
          return
        }
        if (isUserStyle) {
          void recordSavedStyleUse(fetchApiDomain, style.id, projectId)
        }
      })
    },
    [
      state,
      block.candidates,
      block.readOnly,
      candidateSetKey,
      fetchApiDomain,
      projectId,
      userStyleIds,
    ],
  )

  const selectedCatalogStyleId = selectedUserStyleId ?? selectedName ?? ''

  // Only show the off-rail 4th card while its style isn't already one of the
  // rail's own candidates -- guards the frame before the reconcile effect
  // collapses it, so the render never emits a duplicate key / two selected cards.
  const showOffRail =
    offRailCandidate != null &&
    !block.candidates.some((c) => c.style_name === offRailCandidate.style_name)
  const railCards = showOffRail ? [...block.candidates, offRailCandidate] : block.candidates

  return (
    <div className="flex flex-col gap-1.5" data-testid="uip-style-candidates" ref={containerRef}>
      <p
        className="whitespace-pre-wrap break-words text-left text-base font-normal leading-[26px] tracking-[-0.12px] text-white"
        data-testid="uip-style-candidates-hint"
      >
        {STYLE_RAIL_AGENT_HINT}
      </p>
      {showRerunNotice ? (
        <p
          aria-live="polite"
          className="text-xs font-medium text-primary/60"
          data-testid="uip-style-rerun-notice"
          role="status"
          style={FONT_FEATURE_SETTINGS}
        >
          {STYLE_RERUN_NOTICE}
        </p>
      ) : null}
      <div className="flex h-8 items-center justify-between">
        <span className={LABEL_CLASSES} style={FONT_FEATURE_SETTINGS}>
          Style options
        </span>
        {!block.readOnly && (allPresets.length > 0 || userStyleOptions.length > 0) ? (
          <button
            className="text-xs font-medium text-primary/50 transition-colors hover:text-primary"
            data-testid="uip-style-view-more"
            onClick={openAllStyles}
            style={FONT_FEATURE_SETTINGS}
            type="button"
          >
            View more
          </button>
        ) : null}
      </div>
      {/* One layout path for 3 and 4 cards. The cards carry their own aspect ratio and
          width cap, so a 4th off-rail tile just joins the row instead of switching the
          rail to a differently-proportioned grid. */}
      <div className="flex gap-3">
        {railCards.map((candidate) => (
          <StyleCandidateCard
            candidate={candidate}
            disabled={block.readOnly}
            key={candidate.style_name}
            onSelect={handleSelect}
            selected={candidate.style_name === selectedName}
            showAiPickIcon={candidate !== offRailCandidate}
          />
        ))}
      </div>
      {/* The read-only condition rides the render, not an effect: an effect would leave the
          catalog mounted and pickable for the frame between the lock landing and the flush. */}
      {isAllStylesOpen && !block.readOnly ? (
        <BackdropDialog
          onOpenChange={setIsAllStylesOpen}
          open={isAllStylesOpen}
          title="Choose style"
        >
          <ChooseStylePopup
            hideAddStyle
            onClose={() => setIsAllStylesOpen(false)}
            onSelectStyle={handlePickPreset}
            selectedStyleId={selectedCatalogStyleId}
            styleOptions={allPresets}
            userStyles={userStyleOptions}
          />
        </BackdropDialog>
      ) : null}
    </div>
  )
}

export const StyleCandidatesBlockItem = memo(StyleCandidatesBlockItemInner, (prev, next) =>
  styleBlocksEqual(prev.block, next.block),
)

// Which rail card (if any) shows as selected:
//   - applied style IS one of the three -> highlight it.
//   - a style IS applied but is NOT one of the three (e.g. picked from the
//     "View more" full-catalog popup) -> highlight NONE. The rail shows the three
//     recommendations; the off-list choice simply isn't among them, so marking a
//     card (previously the top pick) would falsely claim it as the current style.
//   - nothing applied yet (first render before the agent's auto-pick lands) ->
//     preview the top pick as the default.
function resolveSelectedStyleName(block: StyleCandidatesBlock): null | string {
  const applied = block.appliedStyleName
  if (applied != null && block.candidates.some((candidate) => candidate.style_name === applied)) {
    return applied
  }
  if (applied != null && applied.trim() !== '') {
    return null
  }
  return block.candidates.find((candidate) => candidate.is_top_pick)?.style_name ?? null
}

// Content equality for the memo: renderState.blocks hands us a fresh block object
// on every SSE tick, so a referential check would never skip. Compare only the
// fields that affect this rail's render.
function styleBlocksEqual(a: StyleCandidatesBlock, b: StyleCandidatesBlock): boolean {
  if (
    a.appliedStyleName !== b.appliedStyleName ||
    a.readOnly !== b.readOnly ||
    a.candidates.length !== b.candidates.length
  ) {
    return false
  }
  for (let i = 0; i < a.candidates.length; i += 1) {
    const c = a.candidates[i]
    const d = b.candidates[i]
    if (
      c.style_name !== d.style_name ||
      c.is_top_pick !== d.is_top_pick ||
      c.label !== d.label ||
      c.thumbnail_url !== d.thumbnail_url ||
      // style_text drives the prompt POSTed on a rail tap (switchStyle forwards
      // candidate.style_text), so a text-only regen must re-render or a tap
      // would submit the stale prompt.
      c.style_text !== d.style_text
    ) {
      return false
    }
  }
  return true
}

const StyleCandidateCard = memo(function StyleCandidateCard({
  candidate,
  disabled,
  onSelect,
  selected,
  showAiPickIcon,
}: StyleCandidateCardProps) {
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <button
      aria-pressed={selected}
      className={cn(
        // Aspect ratio, not a fixed height: the canvas main pane is uncapped
        // (675cd42a0 removed SESSION_MAX_WIDTH_CLASS) and splits the viewport
        // evenly with the chat, so a pinned 179px height read flatter the wider
        // the display. 4:3 + a 240px cap reproduces the legacy 752px chat column
        // almost exactly (242x179 before, 240x180 after) while keeping the cards
        // sane on a 2560px screen, where flex-1 alone would stretch them to ~384px.
        'relative min-w-0 flex-1 aspect-[4/3] max-w-[240px] overflow-hidden rounded-xl border-2 bg-black/15 transition-colors',
        selected ? 'border-white' : 'border-transparent hover:border-white/40',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      data-selected={selected}
      data-testid="uip-style-candidate-card"
      disabled={disabled}
      onClick={() => {
        if (selected) {
          return
        }
        onSelect(candidate)
      }}
      type="button"
    >
      {candidate.thumbnail_url && !imgFailed ? (
        <ExternalImage
          alt={candidate.label}
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          onError={() => setImgFailed(true)}
          src={candidate.thumbnail_url}
        />
      ) : (
        <div className="absolute inset-0 size-full bg-white/5" />
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(180deg, rgba(0, 0, 0, 0.40) 0%, rgba(0, 0, 0, 0.00) 29.81%), linear-gradient(180deg, rgba(0, 0, 0, 0.00) 62.01%, rgba(0, 0, 0, 0.70) 88.46%)',
        }}
      />
      <span
        className={cn(
          'absolute right-2.5 top-2.5 flex size-4 items-center justify-center rounded-full',
          selected ? 'border-2 border-white' : 'border border-white/50',
        )}
      >
        {selected ? <span className="size-1.5 rounded-full bg-white" /> : null}
      </span>
      <span className="absolute bottom-2.5 inset-x-2.5 flex items-center gap-1">
        <span
          className="flex-1 truncate text-left text-sm font-medium text-white"
          style={FONT_FEATURE_SETTINGS}
        >
          {candidate.label}
        </span>
        {showAiPickIcon ? (
          <Tooltip
            className="rounded-xs bg-[#444] p-1.5"
            content={
              <span className="text-label-sm text-white" style={FONT_FEATURE_SETTINGS}>
                AI pick
              </span>
            }
            side="top"
            sideOffset={4}
          >
            <span className="inline-flex shrink-0" onClick={(event) => event.stopPropagation()}>
              <MagicEdit className="size-4.5 text-white/70" />
            </span>
          </Tooltip>
        ) : null}
      </span>
    </button>
  )
})
