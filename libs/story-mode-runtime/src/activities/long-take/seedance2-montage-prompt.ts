import { videoPromptMaxChars } from '@reelmakeeasy/common/video-models/registry'

import type { LongTakePromptRoute } from '../../long-take-prompt-router'

export const PURE_COLOR_SCREEN_TRANSITION_GUARD =
  'Do not transition through a pure or solid-color full-screen frame; keep recognizable scene content visible during any color, blur, wipe, or graphic bridge.'
export type Seedance2MontagePlan = {
  shotCount: 2 | 3
  shotRanges: string[]
  tierName: 'High' | 'Low' | 'Medium'
}
export type SeedancePromptModelFamily = 'seedance-2.0' | 'seedance-2.5'

export const SEEDANCE_25_TRANSITION_PROMPT_MAX_CHARS = 12000
export const SEEDANCE_25_MOMENTUM_LANGUAGE =
  'Tempo vocabulary: use concrete, active motion verbs only. Prefer cuts, reframes, reaches, snaps, turns, tracks, whip-pans, reveals, reacts, lands, launches, passes, opens, closes, collides, transforms through action, and clear cause/effect movement.'

export function buildSeedance2MontagePlan(
  durationSeconds: number,
  beatBoundarySeconds?: number,
): Seedance2MontagePlan {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 4
  return buildSeedance2MontagePlanWithBoundary(safeDuration, beatBoundarySeconds)
}

export function buildSeedance2MontageRewritePrompt(params: {
  beatBoundarySeconds?: number
  durationSeconds: number
  /**
   * Count of ordered waypoint keyframes (@Image3..@Image(2+N)) sitting between
   * the boundary frames of a Seedance 2.5 merged transition.
   * Anchor references shift to @Image(3+N)+.
   */
  intermediateReferenceCount?: number
  modelFamily?: SeedancePromptModelFamily
  prompt: string
  promptRoute?: LongTakePromptRoute
  vibe: string
}): string {
  const { beatBoundarySeconds, durationSeconds, prompt, promptRoute, vibe } = params
  const intermediateReferenceCount = params.intermediateReferenceCount ?? 0
  const modelFamily = params.modelFamily ?? 'seedance-2.0'
  const isSeedance25 = modelFamily === 'seedance-2.5'
  const modelLabel = modelFamily === 'seedance-2.5' ? 'Seedance 2.5' : 'Seedance 2.0'
  const seedance25QualityRules = isSeedance25
    ? [
        '- Seedance 2.5 control: keep the prompt as a clean video instruction with explicit time ranges, concrete subject actions, camera movement, environment, and visual style.',
        '- Reference binding: preserve FIRST image identity/materials/composition as the source keyframe and SECOND image identity/materials/composition as the destination keyframe; do not merge, swap, or average them.',
        '- Multi-subject clarity: when multiple people, products, props, or UI elements appear, describe each one separately and keep their positions, scale, materials, colors, logos, and relationships stable.',
        '- Physical continuity: every transformation must be motivated by camera motion, object motion, lighting change, or environment motion; avoid magical morphs, melted geometry, identity changes, or arbitrary occluders.',
        '- Clean output: no subtitles, captions, random text, watermarks, background music, sound effects, or spoken dialogue unless explicitly requested by the brief.',
      ]
    : []
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 4
  const beatBoundary = normalizeBeatBoundarySeconds(safeDuration, beatBoundarySeconds)
  const plan = buildSeedance2MontagePlanWithBoundary(safeDuration, beatBoundary)
  const shotFormatLines = plan.shotRanges
    .map((range) => `${range} Shot description. Camera move.`)
    .join('\n')
  const endTimestamp = formatSeedance2Timestamp(safeDuration)
  const beatBoundaryRule =
    beatBoundary === undefined
      ? ''
      : `- VO beat boundary: outgoing narration runs until ${formatSeedance2Timestamp(
          beatBoundary,
        )}; incoming narration begins after that. Keep outgoing visuals active until this timestamp and do not reveal or land the incoming beat's main subject before it.`
  const musicBeatBoundaryRule =
    beatBoundary === undefined
      ? ''
      : `- Music beat boundary: outgoing shot energy runs until ${formatSeedance2Timestamp(
          beatBoundary,
        )}; incoming shot energy lands after that. Keep outgoing motion active until this timestamp and do not reveal or land the incoming beat's main subject before it.`

  if (isSeedance25) {
    return buildSeedance25MontageRewritePrompt({
      beatBoundaryRule,
      durationSeconds,
      endTimestamp,
      intermediateReferenceCount,
      prompt,
      safeDuration,
      seedance25QualityRules,
      vibe,
    })
  }

  if (promptRoute === 'ads-tangible') {
    return [
      `You are ReelMakeEasy - ${modelLabel} Product Ad Prompt Engineer.`,
      `Rewrite the provided Story Mode transition prompt into one ${modelLabel} API-ready product-story prompt that animates from the FIRST keyframe image to the SECOND keyframe image.`,
      '',
      'Inputs:',
      `- Beat duration: ${durationSeconds}s`,
      `- Vibe: ${vibe}`,
      `- Product story brief: ${prompt}`,
      '- FIRST attached image = exact frame zero / source keyframe',
      '- SECOND attached image = exact final frame / destination keyframe',
      '',
      'Core priorities:',
      '1. Product story first. The segment is one part of a larger product story video, not a standalone poster or generic commercial.',
      '2. Keyframes as anchors. Start from the first image immediately and end exactly in the second image composition.',
      '3. Product/brand lock. Preserve the same product, packaging, logo/wordmark, recurring animal/person/mascot, and brand colors from the inputs.',
      '4. Fast ad pacing. Use purposeful, high-information shots that demonstrate the product, benefit, or problem instead of decorative motion.',
      '5. No invented copy. Only show CTA text, prices, discounts, phone numbers, URLs, guarantees, or offers when the brief explicitly supports them.',
      '',
      'Frame zero rule:',
      '- Do not re-describe the first keyframe as setup.',
      '- The product, customer, hand, pet, package, or environment must already be moving in the first second.',
      '- Begin mid-action: reaching, opening, applying, comparing, reacting, revealing, sliding, pouring, or demonstrating.',
      '',
      'Shot planning rules:',
      beatBoundaryRule,
      `- Use exactly ${plan.shotCount} timestamped shots with these exact ranges: ${plan.shotRanges.join(', ')}.`,
      `- Cover the full beat from 0:00 to ${endTimestamp}; timestamps must be sequential and non-overlapping.`,
      '- Make each shot carry one ad function label in the prompt: HOOK, PRODUCT REVEAL, PROBLEM, DEMO, BENEFIT, PROOF, or CTA only if supported.',
      '- Keep each shot concrete, product-led, and tied to the transcript meaning.',
      `- ${PURE_COLOR_SCREEN_TRANSITION_GUARD}`,
      '- Prefer hands-on product use, package/logo close-ups, simple before/after contrast, customer/pet reaction, callout lines, arrows, or clean overlays when they clarify the selling point.',
      '- Separate camera motion from subject motion. Use static camera, handheld subtle, fast dolly in, tracking shot, whip pan, or speed ramping only when it clarifies the ad beat.',
      '- The final shot must land in the composition, lighting, subject position, and visual world of the second keyframe.',
      '',
      'Per-shot formula:',
      '[FUNCTION] [Subject/product] + [specific action already in progress] + [benefit/problem being communicated] + [camera move] + [only supported text/callout if needed].',
      '',
      '[0:00-...] Shot description. Camera move.',
      `[...-${endTimestamp}] Shot description. Camera move.`,
      '',
      'Quality constraints:',
      ...seedance25QualityRules,
      `- Target 1800-2300 characters total, and always stay under ${videoPromptMaxChars()} characters so the prompt remains compatible with the fallback model.`,
      '- No dialogue. Do not mention narration or spoken lines.',
      '- Do not swap product variants, packaging design, brand identity, animal/person identity, or UI/product details between shots.',
      '- Keep visible text sharp and minimal; avoid turning every keyframe into an ad poster.',
      '',
      `Return only the final ${modelLabel} prompt in the requested timestamped format. No explanation outside the prompt.`,
    ].join('\n')
  }

  if (promptRoute === 'ads-intangible') {
    return [
      `You are ReelMakeEasy - ${modelLabel} Product-Experience Prompt Engineer.`,
      `Rewrite the provided Story Mode transition prompt into one ${modelLabel} API-ready service/software ad prompt that animates from the FIRST keyframe image to the SECOND keyframe image.`,
      '',
      'Inputs:',
      `- Beat duration: ${durationSeconds}s`,
      `- Vibe: ${vibe}`,
      `- Product-experience brief: ${prompt}`,
      '- FIRST attached image = exact frame zero / source keyframe',
      '- SECOND attached image = exact final frame / destination keyframe',
      '',
      'Core priorities:',
      '1. Product experience first. The segment is one part of a larger service/software ad, not a standalone poster or generic brand commercial.',
      '2. Keyframes as anchors. Start from the first image immediately and end exactly in the second image composition.',
      '3. Brand/UI lock. Preserve the same brand name, logo/wordmark, UI surface, dashboard/listing/form/message flow, workflow line, proof panel, CTA surface, and brand colors from the inputs.',
      '4. Fast ad pacing. Use purposeful, high-information shots that demonstrate the service workflow, benefit, customer outcome, proof, or CTA instead of decorative motion.',
      '5. No invented copy. Only show UI text, CTA text, prices, discounts, phone numbers, URLs, guarantees, offers, or exact claims when the brief explicitly supports them.',
      '',
      'Frame zero rule:',
      '- Do not re-describe the first keyframe as setup.',
      '- The UI, dashboard, customer, creator, workflow, proof panel, or brand surface must already be moving in the first second.',
      '- Begin mid-action: clicking, scrolling, filtering, filling a form, sending a message, drawing a connector line, revealing proof, comparing before/after, or landing on a CTA.',
      '',
      'Shot planning rules:',
      beatBoundaryRule,
      `- Use exactly ${plan.shotCount} timestamped shots with these exact ranges: ${plan.shotRanges.join(', ')}.`,
      `- Cover the full beat from 0:00 to ${endTimestamp}; timestamps must be sequential and non-overlapping.`,
      '- Make each shot carry one ad function label in the prompt: HOOK, PROBLEM, SERVICE REVEAL, DEMO, BENEFIT, PROOF, CUSTOMER OUTCOME, or CTA only if supported.',
      '- Keep shots concrete and connected to the transcript meaning. Avoid sterile dashboard-only pacing, vague cinematic filler, arbitrary swirls, floating particles, and unsupported symbolism.',
      `- ${PURE_COLOR_SCREEN_TRANSITION_GUARD}`,
      '- Prefer cursor clicks, page scrolls, card slides, form fills, dashboard highlights, message flows, workflow lines, before/after swipes, customer outcome moments, or clean brand end-card holds when they clarify the selling point.',
      '- The final shot must land in the composition, lighting, subject position, and visual world of the second keyframe.',
      '',
      'Per-shot formula:',
      '[FUNCTION] [Brand/UI/service surface or customer outcome] + [specific action already in progress] + [benefit/problem being communicated] + [camera or UI motion] + [only supported text/callout if needed].',
      '',
      '[0:00-...] Shot description. Camera move.',
      `[...-${endTimestamp}] Shot description. Camera move.`,
      '',
      'Quality constraints:',
      ...seedance25QualityRules,
      `- Target 1800-2300 characters total, and always stay under ${videoPromptMaxChars()} characters so the prompt remains compatible with the fallback model.`,
      '- No dialogue. Do not mention narration or spoken lines.',
      '- Do not swap brand identity, logo, UI structure, customer/creator identity, or product-experience details between shots.',
      '- Keep visible text sharp and minimal; avoid dense fake UI rows and generic CTA copy.',
      '',
      `Return only the final ${modelLabel} prompt in the requested timestamped format. No explanation outside the prompt.`,
    ].join('\n')
  }

  if (promptRoute === 'music') {
    return [
      `You are ReelMakeEasy - ${modelLabel} Music-Video Prompt Engineer.`,
      `Rewrite the provided Story Mode transition prompt into one ${modelLabel} API-ready beat-synced music-video prompt that animates from the FIRST keyframe image to the SECOND keyframe image.`,
      '',
      'Inputs:',
      `- Beat duration: ${durationSeconds}s`,
      `- Vibe: ${vibe}`,
      `- Music-video brief: ${prompt}`,
      '- FIRST attached image = exact frame zero / source keyframe',
      '- SECOND attached image = exact final frame / destination keyframe',
      '',
      'Core priorities:',
      '1. Beat first. The motion must feel cut to the music, with the strongest visual accent landing on the beat boundary or final keyframe.',
      '2. Keyframes as anchors. Start from the first image immediately and end exactly in the second image composition.',
      '3. Performance energy. When the lyric is absent or sparse, use dance, performer movement, expressive eyes/eyebrows, closed-mouth facial expressions, walking, crowd motion, lighting pulses, camera rhythm, or environment energy; do not show singing, rapping, speaking, lip-sync, mouthing lyrics, or visible mouth/lip movement during non-vocal portions.',
      '4. Identity lock. Preserve the same performer identity, race, facial features, wardrobe logic, and uploaded character references.',
      '5. No microphones. Do not introduce handheld microphones, mic stands, headset mics, recording booths, or visible recording gear; when lyrics are present, singing/rapping should read through face, posture, movement, camera, lighting, and body energy.',
      '6. No lyric text. Do not add captions, subtitles, decorative typography, signage, or UI unless the user explicitly asked for visible text.',
      '',
      'Frame zero rule:',
      '- Do not re-describe the first keyframe as setup.',
      '- Begin with motion already underway: body movement, head turn, hand gesture, camera push, walking stride, light pulse, crowd movement, or environmental rhythm.',
      '',
      'Shot planning rules:',
      musicBeatBoundaryRule ||
        '- If no explicit boundary is provided, create a clear rhythmic accent near the middle or final third of the beat.',
      `- Cover the full beat from 0:00 to ${endTimestamp}; timestamps must be sequential and non-overlapping.`,
      `- Use exactly ${plan.shotCount} timestamped music-video shots with these exact ranges: ${plan.shotRanges.join(', ')}.`,
      '- Keep the bridge between unrelated scenes brief; spend most of the segment on readable performance, camera, face, body, lighting, or environment motion.',
      `- ${PURE_COLOR_SCREEN_TRANSITION_GUARD}`,
      '- Avoid slow motion unless the brief clearly implies a quiet, suspended, ambient, or emotional breath.',
      '- The final shot must land in the composition, lighting, subject position, and visual world of the second keyframe.',
      '',
      'Per-shot formula:',
      '[MUSIC BEAT] [Performer/subject/environment] + [specific rhythmic action already in progress] + [lighting/energy] + [camera move].',
      '',
      '[0:00-...] Shot description. Camera move.',
      `[...-${endTimestamp}] Shot description. Camera move.`,
      '',
      'Quality constraints:',
      ...seedance25QualityRules,
      `- Target 1800-2300 characters total, and always stay under ${videoPromptMaxChars()} characters so the prompt remains compatible with the fallback model.`,
      '- No dialogue. Do not mention narration or spoken lines.',
      '- Do not morph faces, swap identity, change race, change wardrobe identity, or drift uploaded character references.',
      '- Keep motion vivid and readable; avoid static holds, arbitrary swirls, and unsupported symbolic transformations.',
      '',
      `Return only the final ${modelLabel} prompt in the requested timestamped format. No explanation outside the prompt.`,
    ].join('\n')
  }

  return [
    `You are ReelMakeEasy - ${modelLabel} Beat-Synced Prompt Engineer.`,
    `Rewrite the provided Story Mode transition prompt into one ${modelLabel} API-ready beat prompt that animates from the FIRST keyframe image to the SECOND keyframe image.`,
    '',
    'Inputs:',
    `- Beat duration: ${durationSeconds}s`,
    `- Shot count: ${plan.shotCount}`,
    `- Shot timestamp ranges: ${plan.shotRanges.join(', ')}`,
    `- Vibe: ${vibe}`,
    `- Visual script: ${prompt}`,
    '- FIRST attached image = exact frame zero / source keyframe',
    '- SECOND attached image = exact final frame / destination keyframe',
    '',
    'Core priorities:',
    '1. Visual script first. Every shot must execute the provided visual script, not invent a new story.',
    '2. Keyframes as anchors. The first attached image is already visible at 0:00, and the final shot must explicitly arrive at the second attached image.',
    '3. Vibe as tone. Use the vibe to shape lighting, pacing, atmosphere, and material detail.',
    '',
    'Frame zero rule:',
    '- Do not spend the first shot re-describing what is already in the first keyframe.',
    '- The action must be underway from the very first second.',
    '- Start with the subject already moving, reacting, turning, pulling, surging, or drifting.',
    '',
    'Shot planning rules:',
    beatBoundaryRule,
    `- Use exactly ${plan.shotCount} timestamped shots with these exact ranges: ${plan.shotRanges.join(', ')}.`,
    '- Each shot uses one primary subject and one primary action.',
    '- Separate camera movement from subject movement. If the subject moves strongly, keep the camera stable; if the camera moves, keep subject motion simple.',
    '- Do not invent new blockers, occluders, intermediate props, or symbolic transformations that are not supported by either keyframe, and do not morph unrelated objects, surfaces, or scenes into each other; keep the bridge between scenes short, and put richer, more natural, grounded motion in the opening and landing shots.',
    `- ${PURE_COLOR_SCREEN_TRANSITION_GUARD}`,
    '- Front-load momentum so the cut lands slightly early rather than late.',
    '- The final shot must end in the composition, lighting, subject position, and visual world of the second keyframe.',
    '',
    'Per-shot formula:',
    '[Subject] + [Action in present tense, already in motion] + [Environment/lighting] + [Camera].',
    '',
    shotFormatLines,
    '',
    'Quality constraints:',
    ...seedance25QualityRules,
    `- Target 1800-2300 characters total, and always stay under ${videoPromptMaxChars()} characters so the prompt remains compatible with the fallback model.`,
    '- Include rich texture, atmospheric detail, environmental motion, and emotional tone when short.',
    '- Trim redundant adjectives if long.',
    '- Keep the transition bridge brief. If the beat is longer, spend more of the motion on the outgoing and incoming scenes.',
    '- The outgoing and incoming scene motion must feel natural, readable, story-consistent, and emotionally aligned with what this beat is trying to express.',
    '- Motion should be physically plausible and visually motivated by the outgoing and incoming shots.',
    '- Do not invent blockers, occluders, intermediate props, symbolic transformations, or other unsupported visual elements.',
    '- Do not morph unrelated objects, surfaces, or scenes into each other, and avoid confusing or arbitrary actions that are hard to understand.',
    '- No dialogue. Do not mention narration or spoken lines.',
    '- Subject names must be concrete, never vague pronouns.',
    '- For visible faces: Keep facial features unchanged, no face drift, maintain identity consistency.',
    '- For objects/products: Maintain original materials and geometry, no warping.',
    '- For text in frame: Sharp readable text, no text distortion.',
    '',
    `Return only the final ${modelLabel} prompt in the requested format. No explanation outside the prompt.`,
  ].join('\n')
}

function buildSeedance25MontageRewritePrompt(params: {
  beatBoundaryRule: string
  durationSeconds: number
  endTimestamp: string
  /** Waypoint keyframe count of a merged transition; anchors shift to @Image(3+N)+. */
  intermediateReferenceCount: number
  prompt: string
  safeDuration: number
  seedance25QualityRules: string[]
  vibe: string
}): string {
  const {
    beatBoundaryRule,
    durationSeconds,
    endTimestamp,
    intermediateReferenceCount,
    prompt,
    safeDuration,
    seedance25QualityRules,
    vibe,
  } = params
  const anchorReferenceStart = 3 + intermediateReferenceCount
  const seedance25SegmentRanges = buildSeedance25SegmentRanges(safeDuration)
  const seedance25ShotFormatLines = seedance25SegmentRanges
    .map(
      (range) =>
        `${range} [shot size + angle] Subject blocking/action; camera/lens/framing; environment or lighting change; story purpose.`,
    )
    .join('\n')

  return [
    'You are the Seedance 2.5 Story Segment Director.',
    'Expand and enrich the provided Story Mode visual script into one API-ready fast-paced story-segment prompt for reference-to-video generation.',
    '',
    'Important interpretation:',
    '- This is not a compression rewrite. Preserve the VO/user intent and add relevant visible story information when the source brief is sparse.',
    '- This is NOT a single static shot, not a three-part entry/core/exit prompt, and not static transition filler.',
    '- Treat the duration as one part of a larger story video: a compact edited scene made of multiple internal camera shots.',
    '- The prompt may include multiple timestamped internal shots/camera setups inside the same generated clip, chosen for story relevance rather than a fixed quota.',
    '',
    'Reference-to-video protocol:',
    '- @Image1 is the exact first frame/source keyframe. Begin visually on @Image1 in the first instant.',
    '- @Image2 is the exact final frame/destination keyframe. Finish visually on @Image2 at the end of the segment.',
    ...(intermediateReferenceCount > 0
      ? [
          `- @Image3 through @Image${2 + intermediateReferenceCount} are ORDERED waypoint keyframes between the sub-segments of the input timeline. Pass through each waypoint composition in order, at the sub-segment boundary times given in the input, without freezing on it.`,
          `- @Image${anchorReferenceStart} and later, when present, are anchor references for characters, products, props, logos, UI, wardrobe, materials, and brand identity. Use them as identity/material references, not as extra unrelated scenes.`,
          `- Preserve the @Image1/@Image2 composition anchors and the waypoint order while using @Image${anchorReferenceStart}+ to keep recurring assets stable across the internal camera shots.`,
        ]
      : [
          '- @Image3 and later, when present, are anchor references for characters, products, props, logos, UI, wardrobe, materials, and brand identity. Use them as identity/material references, not as extra unrelated scenes.',
          '- Preserve @Image1 and @Image2 composition anchors while using @Image3+ to keep recurring assets stable across the internal camera shots.',
        ]),
    '',
    'Inputs:',
    `- Segment duration: ${durationSeconds}s`,
    `- Suggested internal visual-beat ranges: ${seedance25SegmentRanges.join(', ')}`,
    `- Vibe: ${vibe}`,
    `- VO-grounded visual script / user intent to enrich: ${prompt}`,
    '',
    'Core priorities:',
    '1. Story segment first. Execute the story intent as a fast, professional, high-information segment, not decorative camera motion.',
    '2. Keyframes as references. Start from @Image1 immediately and end exactly in @Image2 composition, while allowing multiple internal camera shots between them.',
    '3. Enrichment from intent. If the visual script is thin, add related story action, gestures, reactions, product/prop interactions, environmental responses, and payoff moments grounded in the VO, user intent, assets, and keyframes.',
    '4. Professional camera language. Every internal timestamped visual beat should include shot size, camera angle, subject blocking, motivated action, camera/lens/framing, and story purpose.',
    '5. Fast pacing. Introduce a meaningful new visual beat roughly every 2-4 seconds when the segment can support it. Default to fast cuts, decisive reframes, visible subject movement, and clear cause/effect action.',
    '6. Continuity lock. Preserve character/product/logo/material/UI identity and spatial relationships across all internal shots.',
    `7. ${SEEDANCE_25_MOMENTUM_LANGUAGE}`,
    '',
    'Frame zero rule:',
    '- Do not re-describe @Image1 as setup.',
    '- The first internal shot must begin mid-action in the first second.',
    '- Start with the subject, product, camera, environment, or light already moving with intention.',
    '',
    'Internal camera-shot planning rules:',
    beatBoundaryRule,
    `- Cover the full segment from 0:00 to ${endTimestamp}; timestamps must be sequential and non-overlapping.`,
    '- Use the suggested ranges as a pacing scaffold, not a fixed shot quota. Choose the number and length of internal visual beats from the VO/user intent and what relevant visual information is needed.',
    ...(intermediateReferenceCount > 0
      ? [
          '- The input timeline is stitched from ordered sub-segments with absolute time ranges. Keep every sub-segment boundary time and its story content in order; enrich inside each sub-segment, never reorder, drop, or blend sub-segments together.',
        ]
      : []),
    '- Use director-style progression: establishing wide or medium, kinetic move-in, insert detail, over-shoulder/action angle, reaction close-up, product/prop close-up, reveal, payoff/landing.',
    '- Vary shot scale and angle. Do not repeat the same wide/medium/close-up pattern mechanically.',
    '- Cut/reframe because the action motivates it: hand reaches, wrapper snaps, expression changes, product is used, light shifts, environment reacts, result appears.',
    '- Avoid unrelated montage, abrupt location jumps, magical morphs, time-lapse, arbitrary occluders, random particles, decorative swirls, single-pose filler, and low-information camera wandering.',
    `- ${PURE_COLOR_SCREEN_TRANSITION_GUARD}`,
    '- The final internal shot must land in the composition, lighting, subject position, and visual world of @Image2.',
    '',
    'Timestamped internal-shot format:',
    seedance25ShotFormatLines,
    '',
    'Quality constraints:',
    ...seedance25QualityRules,
    `- Target 2500-4200 characters total, and always stay under ${SEEDANCE_25_TRANSITION_PROMPT_MAX_CHARS} characters for Seedance 2.5.`,
    '- No dialogue. Do not mention narration or spoken lines.',
    '- Subject names must be concrete, never vague pronouns.',
    '- Keep faces, products, packaging, logos, UI, materials, and geometry stable. No face identity changes, warped text, swapped variants, or melted objects.',
    '- Visible text must be sharp, minimal, and supported by the brief.',
    '',
    'Return only the final Seedance 2.5 prompt in the requested timestamped internal-shot format. No explanation outside the prompt.',
  ].join('\n')
}

function buildSeedance25SegmentRanges(safeDuration: number): string[] {
  const minCount = safeDuration >= 20 ? 7 : safeDuration >= 10 ? 4 : 2
  const maxCount = safeDuration >= 20 ? 10 : safeDuration >= 10 ? 6 : 3
  const shotCount = Math.min(maxCount, Math.max(minCount, Math.round(safeDuration / 3)))
  return buildShotRangesFromDurations(
    safeDuration,
    Array.from({ length: shotCount }, () => safeDuration / shotCount),
  )
}

function buildSeedance2MontagePlanWithBoundary(
  safeDuration: number,
  beatBoundarySeconds?: number,
): Seedance2MontagePlan {
  const boundary = normalizeBeatBoundarySeconds(safeDuration, beatBoundarySeconds)
  if (boundary !== undefined) {
    const bridgeDuration = safeDuration > 6 && boundary + 1.5 < safeDuration ? 1 : 0
    const shotDurations =
      bridgeDuration > 0
        ? [boundary, bridgeDuration, safeDuration - boundary - bridgeDuration]
        : [boundary, safeDuration - boundary]
    const shotRanges = buildShotRangesFromDurations(safeDuration, shotDurations)
    return {
      shotCount: shotRanges.length as 2 | 3,
      shotRanges,
      tierName: safeDuration <= 3.5 ? 'High' : safeDuration <= 6 ? 'Medium' : 'Low',
    }
  }

  const shotCount = safeDuration > 6 ? 3 : 2
  const tierName = safeDuration <= 3.5 ? 'High' : safeDuration <= 6 ? 'Medium' : 'Low'
  const roundedTotalHalfSeconds = Math.max(shotCount, Math.round(safeDuration * 2))
  const shotDurations =
    shotCount === 3
      ? (() => {
          // Keep the bridge shot brief so longer beats spend more time
          // animating the outgoing and incoming scenes.
          const bridgeHalfSeconds = 2
          const remainingHalfSeconds = roundedTotalHalfSeconds - bridgeHalfSeconds
          const firstHalfSeconds = Math.floor(remainingHalfSeconds / 2)
          const lastHalfSeconds = remainingHalfSeconds - firstHalfSeconds
          return [firstHalfSeconds / 2, bridgeHalfSeconds / 2, lastHalfSeconds / 2]
        })()
      : (() => {
          const baseHalfSeconds = Math.floor(roundedTotalHalfSeconds / shotCount)
          const remainder = roundedTotalHalfSeconds % shotCount
          return Array.from(
            { length: shotCount },
            (_unused, index) => (baseHalfSeconds + (index < remainder ? 1 : 0)) / 2,
          )
        })()

  const shotRanges = buildShotRangesFromDurations(safeDuration, shotDurations)

  return {
    shotCount: shotCount as 2 | 3,
    shotRanges,
    tierName,
  }
}

function buildShotRangesFromDurations(safeDuration: number, shotDurations: number[]): string[] {
  let cursor = 0
  return shotDurations.map((duration, index) => {
    const start = cursor
    cursor = index === shotDurations.length - 1 ? safeDuration : cursor + duration
    return `[${formatSeedance2Timestamp(start)}-${formatSeedance2Timestamp(cursor)}]`
  })
}

function formatSeedance2Timestamp(seconds: number): string {
  const roundedSeconds = Number(seconds.toFixed(3))
  if (Number.isInteger(roundedSeconds)) {
    return `0:${String(roundedSeconds).padStart(2, '0')}`
  }
  const fixed = String(roundedSeconds)
  const [whole, decimal] = fixed.split('.')
  return `0:${String(Number(whole)).padStart(2, '0')}.${decimal}`
}

function normalizeBeatBoundarySeconds(
  safeDuration: number,
  beatBoundarySeconds?: number,
): number | undefined {
  if (!Number.isFinite(beatBoundarySeconds)) {
    return undefined
  }
  const boundary = Number(beatBoundarySeconds)
  const minSegmentSeconds = 0.5
  if (boundary < minSegmentSeconds || safeDuration - boundary < minSegmentSeconds) {
    return undefined
  }
  return Number(boundary.toFixed(3))
}
