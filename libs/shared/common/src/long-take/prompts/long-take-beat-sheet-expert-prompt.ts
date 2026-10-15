import { type CameraStyle, preferredShotRhythm } from '../camera-craft'
import { buildLongTakeRoutedPromptTemplate, type LongTakePromptRoute } from '../prompt-router'

type BeatSheetTimingGuidance = {
  criticalRule: string
  overMaxRule: string
  preferenceRule: string
  range: string
}

export function buildLongTakeBeatSheetExpertPrompt(params: {
  auditFeedback?: Array<{
    attempt: number
    previousOutput: Array<{ beat_id?: number; duration?: number; segment_text: string }>
    reasons: string[]
  }>
  /** Dynamic prefers shorter shots (3-6s); Calm or absent keeps 5-8s. */
  cameraStyle?: CameraStyle
  promptRoute?: LongTakePromptRoute
  timestampedTranscript: string
  /**
   * Accepted for call-site stability but intentionally unused: planning is
   * model-agnostic -- every model gets the same beat-sheet prompt.
   */
  transitionVideoModel?: string
}): string {
  const { auditFeedback, promptRoute = 'general', timestampedTranscript } = params
  const shotTiming = buildBeatSheetTimingGuidance('shot', params.cameraStyle)
  const beatTiming = buildBeatSheetTimingGuidance('beat', params.cameraStyle)
  const auditFeedbackSection =
    auditFeedback && auditFeedback.length > 0
      ? `
---

PREVIOUS ATTEMPTS FAILED — DO NOT REPEAT THESE MISTAKES:

${auditFeedback
  .map(
    (entry) => `Attempt ${entry.attempt} failure reasons:
${entry.reasons.map((r) => `- ${r}`).join('\n')}

Attempt ${entry.attempt} (incorrect) beat sheet:
${JSON.stringify(entry.previousOutput, null, 2)}`,
  )
  .join('\n\n')}

Study all failure reasons above, identify which beats caused the violations, and produce a corrected segmentation.

---
`
      : ''
  if (promptRoute === 'abstract') {
    return buildAbstractLongTakeBeatSheetExpertPrompt({
      auditFeedbackSection,
      timing: beatTiming,
      timestampedTranscript,
    })
  }
  if (promptRoute === 'ads-tangible') {
    return buildAdsTangibleLongTakeBeatSheetExpertPrompt({
      auditFeedbackSection,
      timing: beatTiming,
      timestampedTranscript,
    })
  }
  if (promptRoute === 'ads-intangible') {
    return buildAdsIntangibleLongTakeBeatSheetExpertPrompt({
      auditFeedbackSection,
      timing: beatTiming,
      timestampedTranscript,
    })
  }
  const generalPrompt = `Role: Expert Video Editor and Beat Sheet Writer with Visual Intelligence.
You specialize in the "Show, Don't Tell" principle — translating spoken ideas into concrete, watchable visual moments.
Input: A timestamped Voice-Over transcript where each word is annotated with its cumulative end time: word(end_time_s).
Objective: Segment the transcript into a Beat Sheet JSON using three-way perception: visual planning, semantic boundaries, and timing awareness.

---

Shot Segmentation (Three-Perception Driven)

Before writing any output, silently determine all cut points. Do NOT output intermediate steps; output only the final JSON object with a top-level "beat_sheet" array.

Determine cut points using the following priority order:

1. **Visual Perception (Highest Priority)**
   Cut when the visual expression must reset — i.e., a different image is needed on screen:
   - Subject changes (e.g., person → concept → product)
   - Symbol system changes (Live Action ↔ UI/Infographic ↔ Composited Graphic)
   - Causal stage changes (cause → mechanism → result)
   - Perspective shift (macro → micro, abstract → concrete, claim → proof)
   - Scene or era switch

   To assess visual resets, silently classify each clause by its expression mode (do NOT output this):
   - **Literal**: directly show the person, object, or place mentioned. If a specific person is named (e.g., "Elon Musk"), the visual must feature their face/likeness.
   - **Symbolic**: show meaning through formal sign systems — data visualizations, diagrams, UI interfaces. The image must be "read" rather than felt.
   - **Cultural Context**: show the human reality or societal value implied by the idea — not the subject itself, but the world around it (e.g., freedom, chaos, progress, intimacy).
   A change in expression mode is a strong signal for a visual cut.

2. **Semantic Boundaries**
   - Subject Pivot (active subject changes) → MUST CUT
   - Emotional Turn (sentiment flips drastically) → MUST CUT
   - Enumerations and feature lists → do NOT split; let video's internal motion handle progression

3. **Timing Awareness (Hard Rules)**
   Read cumulative timestamps directly from the input — do NOT estimate:
   - Shot duration MUST be in ${shotTiming.range}
   - ${shotTiming.preferenceRule}
   - Duration < 2s → MUST merge with adjacent segment (unless Subject Pivot prevents it); merge only if it preserves a single visual expression unit
   - ${shotTiming.overMaxRule}

4. **Safe Boundaries**
   - Do NOT split inside names, numbers, or short fixed phrases (e.g., "iPhone 15 Pro Max", "2.4 billion users", "New York City")
   - Rhythm consistency: avoid many near-minimum-length shots in a row unless the VO is intentionally punchy

---

Shot Output

Output each shot with the following fields:
- beat_id: 1-indexed integer
- segment_text: verbatim words from transcript, NO rewriting or paraphrasing
- time_range: { start, end } — start = first word's start time, end = last word's end time (read directly from timestamps, do NOT estimate)
- duration: end - start (seconds)

CRITICAL RULES:
- segment_text must be verbatim from the transcript — copy words exactly as they appear (without the timestamp annotations)
- The concatenation of all segment_text values must reproduce the full transcript word sequence exactly
- time_range values must be read from the timestamps in the input, never estimated
- ${shotTiming.criticalRule}

Timestamped Transcript:
${timestampedTranscript}
${auditFeedbackSection}`

  return buildLongTakeRoutedPromptTemplate({
    generalPrompt,
    promptRoute,
    templateName: 'beat-sheet',
  })
}

function buildAbstractLongTakeBeatSheetExpertPrompt(params: {
  auditFeedbackSection: string
  timestampedTranscript: string
  timing: BeatSheetTimingGuidance
}): string {
  const { auditFeedbackSection, timing, timestampedTranscript } = params
  return `Role: Concept Explainer Segmenter.

Input: A timestamped voice-over transcript where each word has an end timestamp: word(end_time_s).

Objective: Segment the transcript into beats for an abstract concept explainer.

Core Rule:
Each beat should correspond to one key concept, bullet point, claim, example, explanation step, proof point, contrast, or CTA.
Do not segment by visual ideas, metaphor opportunities, or possible scene changes.

Segmentation Rules:
- If the script has a list or bullet-point structure, each bullet or key concept should usually become its own beat.
- If a bullet point contains a claim plus a short explanation, keep them together when they form one teaching unit.
- Split when the script moves to a new key concept, named belief, example, proof point, contrast, implication, or CTA.
- Do not split just because a sentence contains multiple possible visuals.
- Do not split just because the concept is abstract.

Timing Rules:
- Every beat must be in ${timing.range}.
- ${timing.preferenceRule}
- ${timing.overMaxRule}
- If a beat is shorter than 2s, merge it with the nearest related concept unless that breaks a major concept boundary.
- Read timestamps directly from the transcript. Do not estimate.

Output:
Return a single valid JSON object. Do not include markdown formatting.

{
  "beat_sheet": [
    {
      "beat_id": 1,
      "segment_text": "verbatim transcript text without timestamps",
      "time_range": { "start": 0, "end": 6.2 },
      "duration": 6.2
    }
  ]
}

Critical:
- segment_text must be copied exactly from the transcript, without timestamp annotations.
- All segment_text values together must reproduce the transcript word sequence exactly.
- time_range.start is the first word's start time; time_range.end is the last word's end time.
- ${timing.criticalRule}

Timestamped Transcript:
${timestampedTranscript}
${auditFeedbackSection}`
}

function buildAdsIntangibleLongTakeBeatSheetExpertPrompt(params: {
  auditFeedbackSection: string
  timestampedTranscript: string
  timing: BeatSheetTimingGuidance
}): string {
  const { auditFeedbackSection, timing, timestampedTranscript } = params
  return `Role: Intangible Product Ad Segmenter.

Input: A timestamped voice-over transcript where each word has an end timestamp: word(end_time_s).

Objective:
Segment the transcript into beats for a short-form ad promoting a service, software product, platform, marketplace, app, agency, or brand offer.

Core Rule:
Each beat should correspond to one advertising function, not one possible visual scene.

Segmentation Rules:
- Split when the ad moves to a new function: hook, problem/desire, brand/service reveal, workflow/demo step, feature/benefit, proof/social proof, offer, or CTA.
- Keep brand names, platform names, website/app mentions, logo mentions, creator/influencer names, and CTA phrases attached to the beat they support.
- If the script describes a process, workflow, dashboard, website, listing, form, booking flow, marketplace, or integration, preserve that as a demo/workflow beat.
- Feature lists may become separate beats only when each feature needs its own UI callout, workflow step, example, proof moment, or CTA.
- Keep fast feature phrases together when they all support the same product screen or workflow shot.
- If the transcript contains an explicit CTA, offer, website/app direction, purchase/download/book/learn-more action, or closing next step, keep that CTA phrase attached to the beat it supports.
- If a CTA is shorter than 2s, merge it with the nearest closing brand/offer beat.

Timing Rules:
- Every beat must be in ${timing.range}.
- ${timing.preferenceRule}
- If a beat is shorter than 2s, merge it with the nearest related ad-function beat.
- ${timing.overMaxRule}
- Read timestamps directly from the transcript. Do not estimate.

Output:
Return a single valid JSON object. Do not include markdown formatting.

{
  "beat_sheet": [
    {
      "beat_id": 1,
      "segment_text": "verbatim transcript text without timestamps",
      "time_range": { "start": 0, "end": 6.2 },
      "duration": 6.2
    }
  ]
}

Critical:
- segment_text must be copied exactly from the transcript, without timestamp annotations.
- All segment_text values together must reproduce the transcript word sequence exactly.
- time_range.start is the first word's start time; time_range.end is the last word's end time.
- ${timing.criticalRule}

Timestamped Transcript:
${timestampedTranscript}
${auditFeedbackSection}`
}

function buildAdsTangibleLongTakeBeatSheetExpertPrompt(params: {
  auditFeedbackSection: string
  timestampedTranscript: string
  timing: BeatSheetTimingGuidance
}): string {
  const { auditFeedbackSection, timing, timestampedTranscript } = params
  return `Role: Tangible Product Ad Segmenter.

Input: A timestamped voice-over transcript where each word has an end timestamp: word(end_time_s).

Objective:
Segment the transcript into beats for a short-form ad promoting a physical product.

Core Rule:
Each beat should correspond to one advertising function, not one possible visual scene.

Segmentation Rules:
- Split when the ad moves to a new function: hook, problem/desire, product reveal, feature/benefit, demo/usage, proof/social proof, offer, or CTA.
- Keep brand names, product names, packaging mentions, creator/influencer names, and CTA phrases attached to the beat they support.
- If the script names a physical product, preserve that product as the main anchor of the ad. Do not segment it like a generic explainer.
- Feature lists may become separate beats only when each feature needs its own product callout, demo, or proof moment.
- Keep fast feature phrases together when they all support the same product shot.
- If the transcript contains an explicit CTA, offer, website/app direction, purchase/download/book/learn-more action, or closing next step, keep that CTA phrase attached to the beat it supports.
- If a CTA is shorter than 2s, merge it with the nearest closing product/offer beat.

Timing Rules:
- Every beat must be in ${timing.range}.
- ${timing.preferenceRule}
- If a beat is shorter than 2s, merge it with the nearest related ad-function beat.
- ${timing.overMaxRule}
- Read timestamps directly from the transcript. Do not estimate.

Output:
Return a single valid JSON object. Do not include markdown formatting.

{
  "beat_sheet": [
    {
      "beat_id": 1,
      "segment_text": "verbatim transcript text without timestamps",
      "time_range": { "start": 0, "end": 6.2 },
      "duration": 6.2
    }
  ]
}

Critical:
- segment_text must be copied exactly from the transcript, without timestamp annotations.
- All segment_text values together must reproduce the transcript word sequence exactly.
- time_range.start is the first word's start time; time_range.end is the last word's end time.
- ${timing.criticalRule}

Timestamped Transcript:
${timestampedTranscript}
${auditFeedbackSection}`
}

function buildBeatSheetTimingGuidance(
  unit: 'beat' | 'shot',
  cameraStyle?: CameraStyle,
): BeatSheetTimingGuidance {
  const rhythm = preferredShotRhythm(cameraStyle)
  return {
    criticalRule: `Every ${unit} duration must be in [2s, 10s]; prefer ${rhythm} for most ${unit}s`,
    overMaxRule:
      'Duration > 10s → MUST split; split by clause boundaries that map to separate visual expressions',
    preferenceRule: `Prefer ${rhythm} for most ${unit}s when clean boundaries allow it`,
    range: '[2s, 10s]',
  }
}
