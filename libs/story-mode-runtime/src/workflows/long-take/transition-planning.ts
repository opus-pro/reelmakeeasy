import {
  deriveTransitionSlots,
  getMaxRecoverableSlotSeconds,
  MAX_TRANSITION_PAD_FRACTION,
} from '@reelmakeeasy/common/long-take/transition-slot-feasibility'
// ApplicationFailure is sourced from the engine's /common entry, not /workflow or
// /activity: this module is imported from BOTH contexts (stages/visual-sequence.ts
// on the workflow side, activities/long-take/transitions.ts and
// transition-refinement.ts on the activity side). All three re-export the same
// class, so `instanceof ApplicationFailure` holds on either side.
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/common'

import {
  buildLongTakeRoutedPromptTemplate,
  type LongTakePromptRoute,
} from '../../long-take-prompt-router'

import type { LongTakeKeyframeItem, LongTakeShotPlanItem, LongTakeTransitionType } from './types'

const LEGACY_TRANSITION_TEMPLATES: Record<LongTakeTransitionType, string> = {
  vertical:
    '. THEN: A fast vertical camera pan. The view slides vertically as if scanning a tall continuous mural. The movement is rapid and constant, preserving the visual flow between the distinct sections. THE VIEW SLIDES TO:',
  horizontal:
    '. THEN: A fast horizontal camera pan. The view slides laterally as if scanning a continuous mural. The movement is rapid and constant, preserving the visual flow between the distinct sections. THE VIEW SLIDES TO:',
}

export { MAX_TRANSITION_PAD_FRACTION }
const SEEDANCE25_MAX_SEGMENT_SECONDS = 30

export type Seedance25MergedTransitionGroup = {
  /**
   * Boundary keyframes between consecutive members (member i's lastFrame ==
   * member i+1's firstFrame), in order. Sent as @Image3+ waypoint references.
   */
  intermediateKeyframeUris: string[]
  /** Original bridge seeds, kept verbatim for the per-bridge fallback path. */
  members: TransitionPlanSeed[]
  /** The merged clip covering every member's time span. */
  seed: TransitionPlanSeed
}

export type TransitionPlanSeed = {
  beatBoundarySeconds?: number
  durationSeconds: number
  endMs: number
  firstFrameUri: string
  fromAudio?: string
  fromKeyframePrompt: string
  fromPrompt: string
  fromShotId: string
  lastFrameUri: string
  referenceAssetIds?: string[]
  shouldLipSync?: boolean
  startMs: number
  toAudio?: string
  toKeyframePrompt: string
  toPrompt: string
  toShotId: string
  transitionId: string
}

export function assertTransitionPlanFeasible(
  plan: TransitionPlanSeed[],
  maxSlotSeconds: number,
): void {
  const maxRecoverableSeconds = getMaxRecoverableSlotSeconds(maxSlotSeconds)
  for (const seed of plan) {
    if (seed.durationSeconds > maxRecoverableSeconds) {
      throw ApplicationFailure.nonRetryable(
        `Transition ${seed.fromShotId} -> ${seed.toShotId} is ${Number(seed.durationSeconds.toFixed(3))}s; generated clips must be <= ${maxRecoverableSeconds.toFixed(1)}s. Split the storyboard item before video generation.`,
        'TRANSITION_PLAN_SLOT_TOO_LONG',
      )
    }
  }
}

export function buildLegacyPanTransitionPrompt(
  fromPrompt: string,
  toPrompt: string,
  transitionType: LongTakeTransitionType,
  styleText?: string,
  promptRoute?: LongTakePromptRoute,
): string {
  const template =
    LEGACY_TRANSITION_TEMPLATES[transitionType] || LEGACY_TRANSITION_TEMPLATES.horizontal
  const styleLine = styleText
    ? `STYLE: ${styleText}. Keep this style consistent throughout the transition.`
    : ''

  const generalPrompt = [fromPrompt, styleLine, template, toPrompt].filter(Boolean).join('\n')

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt,
    promptRoute,
    templateName: 'transition-video',
  })
}

export function buildSeedance25BoundaryShotPlan(
  shots: LongTakeShotPlanItem[],
): LongTakeShotPlanItem[] {
  const ordered = orderShotsByStart(shots)
  if (ordered.length === 0) {
    return []
  }

  const boundaries: LongTakeShotPlanItem[] = []
  const firstShot = ordered[0]
  boundaries.push(
    buildSeedance25BoundaryShot({
      assetShots: [firstShot],
      id: buildSeedance25BoundaryStartId(firstShot),
      prompt: [
        `Seedance 2.5 boundary keyframe: exact opening frame for story segment ${firstShot.shot_id}.`,
        'This frame will be @Image1 for that generated clip, so it must compose the first visible instant before the action accelerates.',
        `Segment opening action: ${formatShotOpeningPrompt(firstShot)}.`,
      ].join(' '),
      sourceShot: firstShot,
      timeSec: firstShot.time_range.start,
    }),
  )

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const prevShot = ordered[index]
    const nextShot = ordered[index + 1]
    boundaries.push(
      buildSeedance25BoundaryShot({
        assetShots: [prevShot, nextShot],
        id: buildSeedance25BoundaryBetweenId(prevShot, nextShot),
        prompt: [
          `Seedance 2.5 shared boundary keyframe between story segment ${prevShot.shot_id} and ${nextShot.shot_id}.`,
          `It must work as the exact final frame of ${prevShot.shot_id} and the exact first frame of ${nextShot.shot_id}.`,
          `Previous segment landing: ${formatShotEndingPrompt(prevShot)}.`,
          `Next segment opening: ${formatShotOpeningPrompt(nextShot)}.`,
          'Keep recurring characters, products, logos, UI, materials, wardrobe, and spatial relationships stable.',
        ].join(' '),
        sourceShot: nextShot,
        timeSec: nextShot.time_range.start,
      }),
    )
  }

  const lastShot = ordered[ordered.length - 1]
  boundaries.push(
    buildSeedance25BoundaryShot({
      assetShots: [lastShot],
      id: buildSeedance25BoundaryEndId(lastShot),
      prompt: [
        `Seedance 2.5 boundary keyframe: exact closing frame for story segment ${lastShot.shot_id}.`,
        'This frame will be @Image2 for that generated clip, so it must land the story/action clearly at the final instant.',
        `Segment ending action: ${formatShotEndingPrompt(lastShot)}.`,
      ].join(' '),
      sourceShot: lastShot,
      timeSec: lastShot.time_range.end,
    }),
  )

  return boundaries
}

export function buildSeedance25SegmentTransitionPlan(
  shots: LongTakeShotPlanItem[],
  keyframes: LongTakeKeyframeItem[],
  totalDurationSeconds?: number,
): TransitionPlanSeed[] {
  const ordered = orderShotsByStart(shots)
  if (ordered.length === 0) {
    return []
  }

  const boundaryShots = buildSeedance25BoundaryShotPlan(ordered)
  const keyframeByShotId = new Map(keyframes.map((frame) => [frame.shotId, frame.keyframeUrl]))
  const maxShotEnd = ordered.reduce((max, shot) => Math.max(max, shot.time_range.end), 0)
  const finalEndSec = Math.max(maxShotEnd, totalDurationSeconds ?? 0)

  return ordered.map((shot, index) => {
    const firstBoundary = boundaryShots[index]
    const lastBoundary = boundaryShots[index + 1]
    const firstFrameUri = keyframeByShotId.get(firstBoundary.shot_id)
    const lastFrameUri = keyframeByShotId.get(lastBoundary.shot_id)

    if (!firstFrameUri || !lastFrameUri) {
      throw ApplicationFailure.nonRetryable(
        `Missing Seedance 2.5 boundary keyframes for segment ${shot.shot_id}: ${firstBoundary.shot_id} -> ${lastBoundary.shot_id}`,
        'TRANSITION_PLAN_MISSING_KEYFRAMES',
      )
    }

    const startSec = index === 0 ? 0 : shot.time_range.start
    const endSec =
      index === ordered.length - 1
        ? Math.max(shot.time_range.end, finalEndSec)
        : shot.time_range.end
    const durationSeconds = Math.max(1, endSec - startSec)
    if (durationSeconds > SEEDANCE25_MAX_SEGMENT_SECONDS) {
      throw ApplicationFailure.nonRetryable(
        `Seedance 2.5 segment ${shot.shot_id} is ${Number(durationSeconds.toFixed(3))}s; generated clips must be <= ${SEEDANCE25_MAX_SEGMENT_SECONDS}s. Split the storyboard item before video generation.`,
        'TRANSITION_PLAN_SEGMENT_TOO_LONG',
      )
    }

    return {
      durationSeconds,
      endMs: Math.round(endSec * 1000),
      firstFrameUri,
      fromAudio: shot.audio,
      fromKeyframePrompt: firstBoundary.keyframe_prompt,
      fromPrompt: formatSeedance25SegmentVisualScript(shot),
      fromShotId: firstBoundary.shot_id,
      lastFrameUri,
      referenceAssetIds: collectTransitionReferenceAssetIds(shot),
      shouldLipSync: shouldLipSyncShot(shot),
      startMs: Math.round(startSec * 1000),
      toKeyframePrompt: lastBoundary.keyframe_prompt,
      toPrompt: formatShotEndingPrompt(shot),
      toShotId: lastBoundary.shot_id,
      transitionId: `transition_${index}`,
    }
  })
}

/**
 * Greedily merges adjacent legacy transition bridges into Seedance 2.5 clips
 * capped at SEEDANCE25_MAX_SEGMENT_SECONDS. Groups break at:
 * - the duration cap,
 * - photo-passthrough bridges (generated by ffmpeg pan-zoom, not i2v), which
 *   stay as singleton groups,
 * - the perfect-loop tail bridge (wraps back to shot 0), kept singleton,
 * - any timeline discontinuity between seeds (defensive; seeds are contiguous
 *   by construction).
 *
 * Pure and deterministic: safe to call from workflow code.
 */
export function groupSeedance25TransitionSeeds(params: {
  isPhotoPassthroughSeed?: (seed: TransitionPlanSeed) => boolean
  perfectLoop?: boolean
  seeds: TransitionPlanSeed[]
}): Seedance25MergedTransitionGroup[] {
  const { perfectLoop, seeds } = params
  const isPhotoPassthroughSeed = params.isPhotoPassthroughSeed ?? (() => false)
  const maxDurationMs = SEEDANCE25_MAX_SEGMENT_SECONDS * 1000
  const groups: TransitionPlanSeed[][] = []
  let current: TransitionPlanSeed[] = []

  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index]
    const isLoopTail = Boolean(perfectLoop) && index === seeds.length - 1
    if (isPhotoPassthroughSeed(seed) || isLoopTail) {
      if (current.length > 0) {
        groups.push(current)
        current = []
      }
      groups.push([seed])
      continue
    }
    if (current.length > 0) {
      const spanMs = seed.endMs - current[0].startMs
      const contiguous = current[current.length - 1].endMs === seed.startMs
      if (!contiguous || spanMs > maxDurationMs) {
        groups.push(current)
        current = []
      }
    }
    current.push(seed)
  }
  if (current.length > 0) {
    groups.push(current)
  }

  return groups.map((members) => ({
    intermediateKeyframeUris: members.slice(1).map((member) => member.firstFrameUri),
    members,
    seed: buildSeedance25MergedSeed(members),
  }))
}

function buildSeedance25MergedSeed(members: TransitionPlanSeed[]): TransitionPlanSeed {
  const first = members[0]
  if (members.length === 1) {
    return first
  }
  const last = members[members.length - 1]
  const referenceAssetIds: string[] = []
  const seenAssetIds = new Set<string>()
  for (const member of members) {
    for (const assetId of member.referenceAssetIds ?? []) {
      if (!seenAssetIds.has(assetId)) {
        seenAssetIds.add(assetId)
        referenceAssetIds.push(assetId)
      }
    }
  }
  return {
    durationSeconds: (last.endMs - first.startMs) / 1000,
    endMs: last.endMs,
    firstFrameUri: first.firstFrameUri,
    fromAudio: first.fromAudio,
    fromKeyframePrompt: first.fromKeyframePrompt,
    fromPrompt: first.fromPrompt,
    fromShotId: first.fromShotId,
    lastFrameUri: last.lastFrameUri,
    ...(referenceAssetIds.length > 0 && { referenceAssetIds }),
    shouldLipSync: members.some((member) => member.shouldLipSync === true),
    startMs: first.startMs,
    toAudio: last.toAudio,
    toKeyframePrompt: last.toKeyframePrompt,
    toPrompt: last.toPrompt,
    toShotId: last.toShotId,
    // Distinct from every member id so a per-bridge fallback never collides
    // with the merged clip's storage paths.
    transitionId: `${first.transitionId}_m${members.length}`,
  }
}

/**
 * Deterministic timeline-stitched prompt for a merged Seedance 2.5 clip.
 * The activity-side sd2.5 rewrite enriches it; this text is also
 * the prompt of record if the rewrite LLM fails (rewrite fails open).
 */
export function buildSeedance25MergedTransitionPrompt(params: {
  globalScript?: string
  group: Seedance25MergedTransitionGroup
  styleText?: string
}): string {
  const { globalScript, group, styleText } = params
  const { members, seed } = group
  const baseMs = seed.startMs
  const formatRelSec = (ms: number) => Number(((ms - baseMs) / 1000).toFixed(3))
  const waypointLines = members.slice(1).map((member, index) => {
    const imageIndex = 3 + index
    return `@Image${imageIndex} waypoint frame at ${formatRelSec(member.startMs)}s: ${member.fromKeyframePrompt}`
  })
  const anchorStart = 3 + waypointLines.length
  const timelineLines = members.map((member, index) => {
    const voLine = [member.fromAudio, member.toAudio]
      .map((audio) => audio?.trim())
      .filter(Boolean)
      .join(' ')
    return [
      `Sub-segment ${index + 1} (${formatRelSec(member.startMs)}s-${formatRelSec(member.endMs)}s):`,
      `starts from ${member.fromPrompt}`,
      `and lands on ${member.toPrompt}.`,
      voLine ? `VO meaning: ${voLine}` : '',
    ]
      .filter(Boolean)
      .join(' ')
  })
  return [
    `Seedance 2.5 merged story clip objective: generate one continuous clip covering ${members.length} consecutive storyboard bridges as a single fast-paced sequence.`,
    `Clip duration: ${Number(seed.durationSeconds.toFixed(3))}s.`,
    globalScript ? `Overall story context: ${globalScript}` : '',
    styleText ? `Style to preserve: ${styleText}` : '',
    `@Image1 exact opening frame: ${seed.fromKeyframePrompt}`,
    `@Image2 exact final frame: ${seed.toKeyframePrompt}`,
    ...waypointLines,
    'Ordered timeline to execute and enrich (keep every sub-segment boundary time and its story content in order; never reorder, drop, or blend sub-segments):',
    ...timelineLines,
    waypointLines.length > 0
      ? "Pass through each waypoint frame's composition in order at its boundary time without freezing on it."
      : '',
    `Use @Image${anchorStart}+ references, when present, only for recurring character, product, prop, logo, UI, wardrobe, material, and brand identity consistency.`,
    'Each sub-segment should read as professional camera coverage: establish, action angle, insert detail, reaction, reveal, payoff as its content supports.',
    'Use fast, high-information pacing with motivated cuts/reframes every few seconds; avoid static holds, low-information wandering, time-lapse, magical morphs, or stretched slow-motion filler.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildSeedance25StorySegmentPrompt(params: {
  globalScript?: string
  styleText?: string
  transition: TransitionPlanSeed
}): string {
  const { globalScript, styleText, transition } = params
  const transcriptLine = [transition.fromAudio, transition.toAudio]
    .map((audio) => audio?.trim())
    .filter(Boolean)
    .join(' ')
  return [
    'Seedance 2.5 story segment objective: generate one complete storyboard clip, not a transition bridge.',
    `Clip duration: ${Number(transition.durationSeconds.toFixed(3))}s.`,
    globalScript ? `Overall story context: ${globalScript}` : '',
    transcriptLine ? `VO meaning for this clip: ${transcriptLine}` : '',
    styleText ? `Style to preserve: ${styleText}` : '',
    `@Image1 first boundary frame: ${transition.fromKeyframePrompt}`,
    `@Image2 last boundary frame: ${transition.toKeyframePrompt}`,
    `Clip visual script to execute and enrich: ${transition.fromPrompt}`,
    transition.toPrompt ? `Required landing action/final state: ${transition.toPrompt}` : '',
    'Use @Image3+ references, when present, only for recurring character, product, prop, logo, UI, wardrobe, material, and brand identity consistency.',
    'The clip should contain multiple professional internal camera shots when the duration supports it: establish, action angle, insert detail, reaction, reveal, payoff.',
    'Use fast, high-information pacing with motivated cuts/reframes every few seconds; avoid static holds, low-information wandering, time-lapse, magical morphs, or stretched slow-motion filler.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildSeedance2TransitionPrompt(params: {
  beatBoundarySeconds?: number
  fromAudio?: string
  fromKeyframePrompt: string
  fromPrompt: string
  globalScript?: string
  promptRoute?: LongTakePromptRoute
  styleText?: string
  toAudio?: string
  toKeyframePrompt: string
  toPrompt: string
}): string {
  const {
    beatBoundarySeconds,
    fromAudio,
    fromKeyframePrompt,
    fromPrompt,
    globalScript,
    promptRoute,
    styleText,
    toAudio,
    toKeyframePrompt,
    toPrompt,
  } = params
  const beatMeaning = [fromAudio, toAudio]
    .map((audio) => audio?.trim())
    .filter(Boolean)
    .join(' ')
  const beatBoundaryLine = formatBeatBoundaryLine(beatBoundarySeconds)
  const musicBeatBoundaryLine = formatMusicBeatBoundaryLine(beatBoundarySeconds)
  const musicAudioContext = formatMusicTransitionAudioContext({
    beatBoundarySeconds,
    fromAudio,
    toAudio,
  })

  const generalPrompt = [
    'Transition objective: create one continuous cinematic bridge between the outgoing shot and the incoming shot.',
    globalScript ? `Story context: ${globalScript}` : '',
    beatMeaning ? `Beat meaning from transcript: ${beatMeaning}` : '',
    beatBoundaryLine,
    styleText ? `Style to preserve: ${styleText}` : '',
    `Outgoing keyframe: ${fromKeyframePrompt}`,
    `Outgoing motion: ${fromPrompt}`,
    `Incoming keyframe: ${toKeyframePrompt}`,
    `Incoming motion: ${toPrompt}`,
  ]
    .filter(Boolean)
    .join('\n')

  const tangibleAdsPrompt = [
    'Transition objective: create one fast, product-first tangible ad segment that connects the outgoing keyframe to the incoming keyframe.',
    globalScript ? `Story context: ${globalScript}` : '',
    beatMeaning ? `Beat meaning from transcript: ${beatMeaning}` : '',
    beatBoundaryLine,
    styleText ? `Style to preserve: ${styleText}` : '',
    `Outgoing keyframe: ${fromKeyframePrompt}`,
    `Outgoing motion: ${fromPrompt}`,
    `Incoming keyframe: ${toKeyframePrompt}`,
    `Incoming motion: ${toPrompt}`,
    '',
    'Tangible product ad rules:',
    '- Keep the same product, packaging, logo/wordmark, recurring animal/person/mascot, and core brand colors stable across the whole segment.',
    '- Every shot must serve an ad function: hook, product reveal, problem, demo, benefit, proof, or supported CTA.',
    '- Prefer functional product motion, hands-on use, packaging close-ups, before/after contrast, callout lines, arrows, or simple overlays when they help the transcript.',
    '- Do not make a standalone poster, generic brand ad, random discount badge, unrelated product variant, or invented CTA.',
    '- If no explicit CTA exists, land on product/brand memory or benefit instead of inventing a next step.',
  ]
    .filter(Boolean)
    .join('\n')

  const intangibleAdsPrompt = [
    'Transition objective: create one fast, product-experience intangible ad segment that connects the outgoing keyframe to the incoming keyframe.',
    globalScript ? `Story context: ${globalScript}` : '',
    beatMeaning ? `Beat meaning from transcript: ${beatMeaning}` : '',
    beatBoundaryLine,
    styleText ? `Style to preserve: ${styleText}` : '',
    `Outgoing keyframe: ${fromKeyframePrompt}`,
    `Outgoing motion: ${fromPrompt}`,
    `Incoming keyframe: ${toKeyframePrompt}`,
    `Incoming motion: ${toPrompt}`,
    '',
    'Intangible product ad rules:',
    '- Keep brand name, logo, UI, website/app screen, dashboard, workflow, proof panel, and CTA surfaces stable across the whole segment.',
    '- Prefer product-experience motion: cursor click, page scroll, card slide, form fill, dashboard highlight, message flow, workflow line, before/after swipe, or clean brand end-card hold.',
    '- Use human/customer outcome moments when they make the benefit clearer.',
    '- Do not invent unsupported UI copy, prices, discounts, URLs, certifications, phone numbers, guarantees, or exact claims.',
    '- If no explicit CTA exists, land on brand/product memory or concrete benefit instead of inventing a next step.',
  ]
    .filter(Boolean)
    .join('\n')

  const musicPrompt = [
    'Transition objective: create one beat-synced music-video bridge between the outgoing shot and the incoming shot.',
    globalScript ? `Song context: ${globalScript}` : '',
    musicAudioContext,
    musicBeatBoundaryLine,
    styleText ? `Style to preserve: ${styleText}` : '',
    `Outgoing keyframe: ${fromKeyframePrompt}`,
    `Outgoing motion: ${fromPrompt}`,
    `Incoming keyframe: ${toKeyframePrompt}`,
    `Incoming motion: ${toPrompt}`,
    '',
    'Music video transition rules:',
    '- Treat the beat boundary as the musical cut point. Keep outgoing motion alive until the boundary, then land the incoming shot with a clear rhythm hit.',
    '- When either transition half is instrumental / non-vocal, people may appear, but keep that non-vocal portion to dance, walking, expressive eyes/eyebrows, closed-mouth facial expressions, body movement, crowd, lighting, camera, or environment energy. Do not show singing, rapping, speaking, vocal delivery, lip-sync, mouthing lyrics, or visible mouth/lip movement during non-vocal portions.',
    '- Favor visible body/camera/environment motion over slow holds. Use restraint only for quiet ambient sections.',
    '- Do not show lyrics, captions, or decorative text unless the user explicitly asked for visible text.',
    '- Preserve performer identity, race, facial features, wardrobe logic, and uploaded character references across the segment. Do not introduce microphones, mic stands, headset mics, recording booths, or visible recording gear; when lyrics are present, keep vocal performance readable through face, posture, camera, lighting, and body energy.',
  ]
    .filter(Boolean)
    .join('\n')

  const routedPrompt =
    promptRoute === 'ads-tangible'
      ? tangibleAdsPrompt
      : promptRoute === 'ads-intangible'
        ? intangibleAdsPrompt
        : promptRoute === 'music'
          ? musicPrompt
          : generalPrompt

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt: routedPrompt,
    promptRoute,
    templateName: 'transition-video',
  })
}

export function buildTransitionPlan(
  shots: LongTakeShotPlanItem[],
  keyframes: LongTakeKeyframeItem[],
  totalDurationSeconds?: number,
  options?: { perfectLoop?: boolean },
): TransitionPlanSeed[] {
  if (shots.length === 0) {
    return []
  }

  const keyframeByShotId = new Map(keyframes.map((frame) => [frame.shotId, frame.keyframeUrl]))
  const slots = deriveTransitionSlots(shots, totalDurationSeconds, options)

  if (shots.length === 1) {
    const slot = slots[0]
    const onlyShot = slot.fromShot
    const frameUri = keyframeByShotId.get(onlyShot.shot_id)
    if (!frameUri) {
      throw ApplicationFailure.nonRetryable(
        `Missing keyframe for ${onlyShot.shot_id}`,
        'TRANSITION_PLAN_MISSING_KEYFRAMES',
      )
    }

    const prompt = onlyShot.video_prompt || onlyShot.keyframe_prompt
    return [
      {
        durationSeconds: slot.durationSeconds,
        endMs: Math.round(slot.endSec * 1000),
        firstFrameUri: frameUri,
        fromAudio: onlyShot.audio,
        fromKeyframePrompt: onlyShot.keyframe_prompt,
        fromPrompt: prompt,
        fromShotId: onlyShot.shot_id,
        lastFrameUri: frameUri,
        referenceAssetIds: collectTransitionReferenceAssetIds(onlyShot),
        shouldLipSync: shouldLipSyncShot(onlyShot),
        startMs: Math.round(slot.startSec * 1000),
        toAudio: onlyShot.audio,
        toKeyframePrompt: onlyShot.keyframe_prompt,
        toPrompt: prompt,
        toShotId: onlyShot.shot_id,
        transitionId: slot.transitionId,
      },
    ]
  }

  const plan: TransitionPlanSeed[] = []
  const regularSlotCount = shots.length - 1

  slots.forEach((slot, index) => {
    const fromShot = slot.fromShot
    const toShot = slot.toShot
    const firstFrameUri = keyframeByShotId.get(fromShot.shot_id)
    const lastFrameUri = keyframeByShotId.get(toShot.shot_id)
    const isLoopTail = index >= regularSlotCount

    if (!firstFrameUri || !lastFrameUri) {
      if (isLoopTail) {
        throw ApplicationFailure.nonRetryable(
          `Missing keyframes for transition ${fromShot.shot_id} -> ${toShot.shot_id}`,
          'TRANSITION_PLAN_MISSING_KEYFRAMES',
        )
      }

      // The ids we DID get are included because the usual cause is a topology
      // mismatch, not a genuinely absent keyframe: a source project planned
      // with Seedance 2.5 boundary keyframes keys them by boundary id, so a
      // legacy per-shot lookup misses every one of them. Naming the shot alone
      // makes that read as "keyframe generation failed", which sends the next
      // person down the wrong path.
      throw ApplicationFailure.nonRetryable(
        `Missing keyframes for transition ${fromShot.shot_id} -> ${toShot.shot_id}. ` +
          `Planned per-shot over ${keyframeByShotId.size} keyframe(s) keyed [${[...keyframeByShotId.keys()].slice(0, 4).join(', ')}].`,
        'TRANSITION_PLAN_MISSING_KEYFRAMES',
      )
    }

    const fromPrompt = fromShot.exit_prompt || fromShot.video_prompt || fromShot.keyframe_prompt
    const toPrompt = toShot.entry_prompt || toShot.video_prompt || toShot.keyframe_prompt

    plan.push({
      beatBoundarySeconds: computeBeatBoundarySeconds(
        fromShot.time_range.end,
        slot.startSec,
        slot.endSec,
      ),
      durationSeconds: slot.durationSeconds,
      endMs: Math.round(slot.endSec * 1000),
      firstFrameUri,
      fromAudio: fromShot.audio,
      fromKeyframePrompt: fromShot.keyframe_prompt,
      fromPrompt,
      fromShotId: fromShot.shot_id,
      lastFrameUri,
      referenceAssetIds: collectTransitionReferenceAssetIds(fromShot, toShot),
      shouldLipSync: shouldLipSyncTransition(fromShot, toShot),
      startMs: Math.round(slot.startSec * 1000),
      toAudio: toShot.audio,
      toKeyframePrompt: toShot.keyframe_prompt,
      toPrompt,
      toShotId: toShot.shot_id,
      transitionId: slot.transitionId,
    })
  })

  return plan
}

export function buildTransitionPrompt(
  fromPrompt: string,
  toPrompt: string,
  styleText?: string,
  promptRoute?: LongTakePromptRoute,
): string {
  const styleLine = styleText
    ? `STYLE: ${styleText}. Keep this style consistent throughout the transition.`
    : 'Maintain visual continuity throughout the transition.'

  const generalPrompt = [
    `Scene A: ${fromPrompt}`,
    styleLine,
    'Transition: Bridge the two scenes as one continuous cinematic shot. Keep the strongest shared anchor stable when possible, prefer a motivated reframe over arbitrary scanning, and use brief occlusion or motion blur when the visual gap is too large for a direct transform.',
    `Scene B: ${toPrompt}`,
  ]
    .filter(Boolean)
    .join('\n')

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt,
    promptRoute,
    templateName: 'transition-video',
  })
}

function buildSeedance25BoundaryBetweenId(
  prevShot: LongTakeShotPlanItem,
  nextShot: LongTakeShotPlanItem,
): string {
  return `${prevShot.shot_id}__sd25_to__${nextShot.shot_id}`
}

function buildSeedance25BoundaryEndId(shot: LongTakeShotPlanItem): string {
  return `${shot.shot_id}__sd25_end`
}

function buildSeedance25BoundaryShot(params: {
  assetShots: LongTakeShotPlanItem[]
  id: string
  prompt: string
  sourceShot: LongTakeShotPlanItem
  timeSec: number
}): LongTakeShotPlanItem {
  const { assetShots, id, prompt, sourceShot, timeSec } = params
  return {
    audio: '',
    entry_prompt: prompt,
    exit_prompt: prompt,
    human_presence: sourceShot.human_presence,
    keyframe_prompt: prompt,
    requires_lip_sync: false,
    shot_id: id,
    time_range: { end: timeSec, start: timeSec },
    used_asset_id: collectTransitionReferenceAssetIds(...assetShots),
    video_prompt: prompt,
  }
}

function buildSeedance25BoundaryStartId(shot: LongTakeShotPlanItem): string {
  return `${shot.shot_id}__sd25_start`
}

function collectTransitionReferenceAssetIds(...shots: LongTakeShotPlanItem[]): string[] {
  const ids = new Set<string>()
  for (const shot of shots) {
    for (const assetId of shot.used_asset_id ?? []) {
      const normalized = assetId.trim()
      if (normalized) {
        ids.add(normalized)
      }
    }
  }
  return Array.from(ids)
}

function computeBeatBoundarySeconds(
  fromShotEndSec: number,
  transitionStartSec: number,
  transitionEndSec: number,
): number | undefined {
  const duration = transitionEndSec - transitionStartSec
  const boundary = fromShotEndSec - transitionStartSec
  if (!Number.isFinite(boundary) || !Number.isFinite(duration) || duration <= 0) {
    return undefined
  }
  if (boundary <= 0 || boundary >= duration) {
    return undefined
  }
  return Number(boundary.toFixed(3))
}

function formatBeatBoundaryLine(beatBoundarySeconds: number | undefined): string {
  if (!Number.isFinite(beatBoundarySeconds)) {
    return ''
  }
  const boundary = Number(beatBoundarySeconds)
  if (boundary <= 0) {
    return ''
  }
  return `VO timing inside this clip: keep the outgoing beat visually active until ${boundary}s, then reveal or land the incoming beat after that point. Do not visually complete the incoming beat before the narration reaches it.`
}

function formatMusicBeatBoundaryLine(beatBoundarySeconds: number | undefined): string {
  if (!Number.isFinite(beatBoundarySeconds)) {
    return ''
  }
  const boundary = Number(beatBoundarySeconds)
  if (boundary <= 0) {
    return ''
  }
  return `Music beat boundary inside this clip: keep the outgoing shot energy active until ${boundary}s, then reveal or land the incoming shot after that point. Do not visually complete the incoming shot before the music reaches it.`
}

function formatMusicTransitionAudioContext(params: {
  beatBoundarySeconds?: number
  fromAudio?: string
  toAudio?: string
}): string {
  const boundary =
    typeof params.beatBoundarySeconds === 'number' && Number.isFinite(params.beatBoundarySeconds)
      ? Number(params.beatBoundarySeconds)
      : undefined
  const outgoingLabel =
    boundary !== undefined && boundary > 0 ? `Outgoing half before ${boundary}s` : 'Outgoing half'
  const incomingLabel =
    boundary !== undefined && boundary > 0 ? `Incoming half after ${boundary}s` : 'Incoming half'

  return [
    formatMusicTransitionAudioLine(outgoingLabel, params.fromAudio),
    formatMusicTransitionAudioLine(incomingLabel, params.toAudio),
  ].join('\n')
}

function formatMusicTransitionAudioLine(label: string, audio: string | undefined): string {
  const fragment = audio?.trim()
  if (!fragment || fragment === '-') {
    return `${label}: instrumental / non-vocal (empty audio). Keep mouths closed or neutral here.`
  }
  return `${label}: vocal lyric/hook fragment present: ${fragment}`
}

function formatSeedance25SegmentVisualScript(shot: LongTakeShotPlanItem): string {
  return [
    `Storyboard segment ${shot.shot_id}.`,
    `Time range: ${Number(shot.time_range.start.toFixed(3))}s-${Number(
      shot.time_range.end.toFixed(3),
    )}s.`,
    shot.entry_prompt ? `Opening: ${shot.entry_prompt}` : '',
    shot.video_prompt ? `Main visual progression: ${shot.video_prompt}` : '',
    shot.keyframe_prompt ? `Representative visual state: ${shot.keyframe_prompt}` : '',
    shot.exit_prompt ? `Landing: ${shot.exit_prompt}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function formatShotEndingPrompt(shot: LongTakeShotPlanItem): string {
  return shot.exit_prompt || shot.video_prompt || shot.keyframe_prompt
}

function formatShotOpeningPrompt(shot: LongTakeShotPlanItem): string {
  return shot.entry_prompt || shot.video_prompt || shot.keyframe_prompt
}

function orderShotsByStart(shots: LongTakeShotPlanItem[]): LongTakeShotPlanItem[] {
  return [...shots].sort((a, b) => a.time_range.start - b.time_range.start)
}

function shouldLipSyncShot(shot: LongTakeShotPlanItem): boolean {
  const audio = shot.audio.trim()
  return shot.requires_lip_sync === true && Boolean(audio && audio !== '-')
}

function shouldLipSyncTransition(
  fromShot: LongTakeShotPlanItem,
  toShot: LongTakeShotPlanItem,
): boolean {
  return shouldLipSyncShot(fromShot) || shouldLipSyncShot(toShot)
}
