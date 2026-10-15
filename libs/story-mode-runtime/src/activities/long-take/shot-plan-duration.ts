import type { LongTakeShotPlanItem } from '../../workflows/long-take/types'

// Planning is model-agnostic: every model splits shots against the
// same 10s cap. Model-specific behavior belongs to transition generation.
const MAX_SHOT_PLAN_DURATION_SECONDS = 10
const SHOT_PLAN_TIMING_EPSILON_SECONDS = 0.001
// Below this a hole is not worth a shot of its own. MP3 padding and trailing
// silence run to a few frames, and cutting a keyframe plus a video clip for that
// is the waste the earlier tail-fill was rightly removed for. 2s is the beat
// sheet's own minimum shot duration, and a hole this small cannot threaten any
// model cap either: it adds under 2s to a bridge whose tightest ceiling is 22.2s.
const MIN_SHOT_PLAN_FILL_SECONDS = 2

type MusicSplitPromptVariation = {
  entry: string
  exit: string
  keyframe: string
  label: string
  video: string
}

type NormalizeShotPlanDurationsOptions = {
  promptRoute?: string
  /**
   * Voiceover length the plan has to cover, so a transcript that stops short of
   * the audio gets filled here instead of being left to transition planning.
   * Interior holes are filled either way -- they produce an oversize
   * slot with no reference to the audio length -- so omitting this only skips the
   * trailing fill.
   */
  totalDurationSec?: number
}

type NormalizeShotPlanDurationsResult = {
  /** Interior holes filled (count of shots that gained trailing filler). */
  gapClosedShotCount: number
  longShotSplitCount: number
  shotPlan: LongTakeShotPlanItem[]
  /** Seconds of trailing timeline filled to reach totalDurationSec. */
  tailExtendedSeconds: number
  /** Silent filler shots appended to cover the trailing gap. */
  tailFillShotCount: number
}

type ShotPlanFill = {
  /** Seconds of uncovered timeline immediately after each shot, by index. */
  fillSecondsByIndex: Map<number, number>
  gapClosedShotCount: number
  tailExtendedSeconds: number
  tailIndex: number
}

type SplitShotPlanItemParams = {
  forceEmptyAudio?: boolean
  idSuffix: string
  keepFirstShotId: boolean
  maxDurationSec: number
  shot: LongTakeShotPlanItem
}

export function normalizeShotPlanDurations(
  shotPlan: LongTakeShotPlanItem[],
  options: NormalizeShotPlanDurationsOptions = {},
): NormalizeShotPlanDurationsResult {
  if (shotPlan.length === 0) {
    return {
      gapClosedShotCount: 0,
      longShotSplitCount: 0,
      shotPlan,
      tailExtendedSeconds: 0,
      tailFillShotCount: 0,
    }
  }

  const fill = measureShotPlanFill(shotPlan, options.totalDurationSec)

  let longShotSplitCount = 0
  let tailFillShotCount = 0
  const normalized: LongTakeShotPlanItem[] = []
  const maxDurationSec = MAX_SHOT_PLAN_DURATION_SECONDS

  shotPlan.forEach((shot, index) => {
    // The shot itself keeps its own range, so its line and requires_lip_sync
    // stay bound to the seconds it was actually spoken over.
    const chunks = splitShotPlanItem({
      idSuffix: 'part',
      keepFirstShotId: true,
      maxDurationSec,
      shot,
    }).map(applyLipSyncVoiceoverGuard)
    const normalizedChunks =
      options.promptRoute === 'music' ? diversifyMusicSplitChunks(chunks) : chunks
    longShotSplitCount += normalizedChunks.length - 1
    normalized.push(...normalizedChunks)

    const fillSeconds = fill.fillSecondsByIndex.get(index)
    if (fillSeconds === undefined) {
      return
    }
    const filler = buildShotPlanFiller({
      chunkOffset: normalizedChunks.length,
      fillSeconds,
      maxDurationSec,
      shot,
    })
    if (index === fill.tailIndex) {
      tailFillShotCount = filler.length
    }
    normalized.push(...filler)
  })

  return {
    gapClosedShotCount: fill.gapClosedShotCount,
    longShotSplitCount,
    shotPlan: normalized,
    tailExtendedSeconds: fill.tailExtendedSeconds,
    tailFillShotCount,
  }
}

// The transcript ends at the last spoken word; the voiceover file keeps running through
// trailing silence or music. Transition planning stretches the final bridge to the audio
// length, so the plan has to reach it too or that bridge blows the model cap.
export function resolveShotPlanTargetSec(
  transcriptDurationSec: number,
  audioDurationSeconds?: number,
): number {
  return Math.max(transcriptDurationSec, audioDurationSeconds ?? 0)
}

function applyLipSyncVoiceoverGuard(shot: LongTakeShotPlanItem): LongTakeShotPlanItem {
  if (shot.requires_lip_sync !== true || hasShotVoiceover(shot.audio)) {
    return shot
  }
  return { ...shot, requires_lip_sync: false }
}

// Silent filler covering `fillSeconds` after a shot, as `<id>_part_<n>` children
// continuing that shot's own numbering. `_part_n` is a naming that
// buildLongTakeShotPlan's prompt-override pass and the restyle path already
// resolve through the base id, unlike the `_tail_n` clones an earlier tail-fill
// used. Audio is forced empty so applyLipSyncVoiceoverGuard clears
// requires_lip_sync: the filler covers seconds nothing was spoken over, and a
// shot that kept its line here would lip-sync against silence.
function buildShotPlanFiller(params: {
  chunkOffset: number
  fillSeconds: number
  maxDurationSec: number
  shot: LongTakeShotPlanItem
}): LongTakeShotPlanItem[] {
  const { chunkOffset, fillSeconds, maxDurationSec, shot } = params
  const start = Number(shot.time_range.end)
  const chunks = splitShotPlanItem({
    forceEmptyAudio: true,
    idSuffix: 'part',
    keepFirstShotId: false,
    maxDurationSec,
    shot: {
      ...shot,
      time_range: { end: roundShotPlanTime(start + fillSeconds), start },
    },
  }).map(applyLipSyncVoiceoverGuard)

  return chunks.map((chunk, index) => ({
    ...chunk,
    shot_id: `${shot.shot_id}_part_${chunkOffset + index + 1}`,
  }))
}

function hasShotVoiceover(audio: string | undefined): boolean {
  const trimmed = audio?.trim()
  return Boolean(trimmed && trimmed !== '-')
}

// The transition geometry is center-to-center and the FINAL bridge is stretched
// to the voiceover length (deriveTransitionSlots), so any uncovered stretch of
// the timeline -- a hole between two shots, or a transcript that stops short of
// the audio -- reappears downstream as a single oversize video slot no model can
// generate. In one incident, a >=27s uncovered tail became a 42.679s bridge against a
// 22.2s recoverable cap and killed the project non-retryably, after all twelve
// keyframes had already been generated and paid for.
//
// This only MEASURES the holes worth filling; every shot keeps its own range and
// the gaps become separate silent filler shots. Anything under
// MIN_SHOT_PLAN_FILL_SECONDS is left alone, which is what keeps MP3 padding from
// minting a shot.
function measureShotPlanFill(
  shotPlan: LongTakeShotPlanItem[],
  totalDurationSec?: number,
): ShotPlanFill {
  // Array order is time order here: repairNonMonotonicShotTimeRanges has already
  // run and clamps starts forward in this same order.
  const fillSecondsByIndex = new Map<number, number>()
  let gapClosedShotCount = 0

  for (let index = 0; index < shotPlan.length - 1; index += 1) {
    const end = Number(shotPlan[index].time_range.end)
    const nextStart = Number(shotPlan[index + 1].time_range.start)
    if (!Number.isFinite(end) || !Number.isFinite(nextStart)) {
      continue
    }
    if (nextStart - end >= MIN_SHOT_PLAN_FILL_SECONDS) {
      fillSecondsByIndex.set(index, roundShotPlanTime(nextStart - end))
      gapClosedShotCount += 1
    }
  }

  const lastIndex = shotPlan.length - 1
  const lastEnd = Number(shotPlan[lastIndex].time_range.end)
  if (
    typeof totalDurationSec !== 'number' ||
    !Number.isFinite(totalDurationSec) ||
    !Number.isFinite(lastEnd) ||
    totalDurationSec - lastEnd < MIN_SHOT_PLAN_FILL_SECONDS
  ) {
    return { fillSecondsByIndex, gapClosedShotCount, tailExtendedSeconds: 0, tailIndex: -1 }
  }

  const tailExtendedSeconds = roundShotPlanTime(totalDurationSec - lastEnd)
  fillSecondsByIndex.set(lastIndex, tailExtendedSeconds)
  return { fillSecondsByIndex, gapClosedShotCount, tailExtendedSeconds, tailIndex: lastIndex }
}

const ANCHORED_MUSIC_SPLIT_PROMPT_VARIATIONS: MusicSplitPromptVariation[] = [
  {
    entry: 'Open with the song world breathing in: atmosphere, palette, and camera mood lead.',
    exit: 'Let the atmosphere gather momentum for the next musical phrase.',
    keyframe:
      'Establish the theme world and atmosphere. Preserve the same song theme, genre mood, palette, and visual world as the base prompt.',
    label: 'atmosphere',
    video:
      'Use an establishing music-video moment: atmosphere, camera drift, and visual rhythm set the world before performance begins.',
  },
  {
    entry: 'Bring in a performer presence through face, hands, silhouette, or gesture.',
    exit: 'Let the gesture or expression carry the rhythm into the next shot.',
    keyframe:
      'Introduce performer energy: an expressive face, hand gesture, silhouette, or artist-like presence inside the same visual world. Keep any existing character identity, race, wardrobe, and reference-asset cues consistent.',
    label: 'performer gesture',
    video:
      'Feature performer motion with face angles, hand gestures, or rhythmic body language rather than another static atmosphere hold.',
  },
  {
    entry: 'Shift into body motion that lands on the beat.',
    exit: 'Carry the movement forward with a rhythmic step, turn, or sway.',
    keyframe:
      'Add dance, walking, swaying, or clear body motion that matches the music energy while staying faithful to the same theme and visual world.',
    label: 'dance body motion',
    video:
      'Make this segment about visible movement: dancing, walking, swaying, or performance blocking timed to the beat.',
  },
  {
    entry: 'Let the environment pulse with the track.',
    exit: 'Build the visual energy with lights, crowd motion, particles, or camera movement.',
    keyframe:
      'Increase environment energy: lights, crowd silhouettes, stage texture, particles, camera angle, or location motion should respond to the beat.',
    label: 'environment energy',
    video:
      'Use beat-reactive camera motion, lighting changes, crowd or environment energy, and stronger spatial movement.',
  },
  {
    entry: 'Start a build-up toward the lyric, hook, or musical drop.',
    exit: 'End with anticipation for the next lyric, hook, chorus, or beat drop.',
    keyframe:
      'Build toward the first lyric, hook, chorus, or next musical drop. Escalate motion and focus without resolving the whole concept too early.',
    label: 'hook build-up',
    video:
      'Create a build-up moment that points toward the incoming vocal hook, chorus, or instrumental drop with rising motion and anticipation.',
  },
]

const UNANCHORED_MUSIC_SPLIT_PROMPT_VARIATIONS: MusicSplitPromptVariation[] = [
  {
    entry: 'Open with the song world breathing in: atmosphere, palette, and camera mood lead.',
    exit: 'Let the atmosphere gather momentum for the next musical phrase.',
    keyframe:
      'Establish the theme world and atmosphere. Preserve the same song theme, genre mood, palette, and visual world as the base prompt.',
    label: 'atmosphere',
    video:
      'Use an establishing music-video moment: atmosphere, camera drift, and visual rhythm set the world before any identifiable subject appears.',
  },
  {
    entry:
      'Shift the camera and crowd motion onto the beat without introducing a clear new solo subject.',
    exit: 'Carry the camera, dance-floor, or crowd rhythm forward into the next musical phrase.',
    keyframe:
      'Vary the camera language with a push-in, drift, tilt, or parallax move inside the same visual world. Anonymous dancers, crowd silhouettes, partial bodies, or background club movement are allowed, but do not introduce a clear single new face, solo performer, or identifiable character unless one already exists in the base prompt.',
    label: 'camera rhythm',
    video:
      'Make this segment about rhythmic camera motion, framing, parallax, crowd movement, or dance-floor energy while avoiding a clear unreferenced solo subject.',
  },
  {
    entry: 'Let symbolic, crowd, or dance-floor elements move with the lyric or melody.',
    exit: 'Use the symbolic or crowd motion to bridge into the next phrase.',
    keyframe:
      'Add music-reactive motion through props, light, color, reflections, particles, weather, typography, scenery, crowd silhouettes, or anonymous dancing bodies. Keep the same world and avoid turning any unreferenced person into a clear single focal subject.',
    label: 'symbolic motion',
    video:
      'Use symbolic music-video motion from light, props, particles, reflections, scenery, background dancers, or club crowd movement rather than a new clear solo performer.',
  },
  {
    entry: 'Let the environment pulse with the track.',
    exit: 'Build the visual energy with lighting, texture, particles, camera movement, or crowd motion.',
    keyframe:
      'Increase environment energy: lights, club or stage texture, particles, camera angle, location motion, crowd silhouettes, dancing bodies, or graphic rhythm should respond to the beat without adding a clear new identifiable person.',
    label: 'environment energy',
    video:
      'Use beat-reactive camera motion, lighting changes, texture, particles, crowd dancing, or environment energy while keeping any unreferenced human figure silhouetted, partial, in motion blur, out of focus, or part of a group.',
  },
  {
    entry: 'Start a build-up toward the lyric, hook, or musical drop.',
    exit: 'End with anticipation for the next lyric, hook, chorus, or beat drop.',
    keyframe:
      'Build toward the first lyric, hook, chorus, or next musical drop using atmosphere, lighting, composition, crowd energy, dancing silhouettes, and motion. Do not create a clear new face or solo performer without an anchor reference.',
    label: 'hook build-up',
    video:
      'Create a build-up moment with rising motion, light, camera energy, symbolic visuals, or club crowd movement, not a clear new unanchored solo performer.',
  },
]

function appendMusicSplitDirection(
  basePrompt: string | undefined,
  partLabel: string,
  direction: string,
): string {
  const suffix = `Music continuity cue (${partLabel}): ${direction}`
  const trimmed = basePrompt?.trim()
  if (!trimmed) {
    return suffix
  }
  return `${trimmed}\n${suffix}`
}

function diversifyMusicSplitChunks(chunks: LongTakeShotPlanItem[]): LongTakeShotPlanItem[] {
  if (chunks.length <= 1) {
    return chunks
  }

  return chunks.map((chunk, index) => {
    const variations = hasShotCharacterAnchorReference(chunk)
      ? ANCHORED_MUSIC_SPLIT_PROMPT_VARIATIONS
      : UNANCHORED_MUSIC_SPLIT_PROMPT_VARIATIONS
    const variation = variations[index % variations.length]
    const partLabel = `${variation.label} cue ${index + 1}`
    return {
      ...chunk,
      entry_prompt: appendMusicSplitDirection(chunk.entry_prompt, partLabel, variation.entry),
      exit_prompt: appendMusicSplitDirection(chunk.exit_prompt, partLabel, variation.exit),
      keyframe_prompt: appendMusicSplitDirection(
        chunk.keyframe_prompt,
        partLabel,
        variation.keyframe,
      ),
      video_prompt: appendMusicSplitDirection(
        chunk.video_prompt || chunk.keyframe_prompt,
        partLabel,
        variation.video,
      ),
    }
  })
}

function hasShotCharacterAnchorReference(shot: LongTakeShotPlanItem): boolean {
  return (shot.used_asset_id || []).some((assetId) => isCharacterAssetId(assetId))
}

function isCharacterAssetId(assetId: string | undefined): boolean {
  return /^char[_-]/i.test(assetId?.trim() || '')
}

function roundShotPlanTime(value: number): number {
  return Number(value.toFixed(3))
}

function splitAudioAcrossChunks(audio: string, chunkCount: number): string[] {
  const trimmed = audio.trim()
  if (!trimmed) {
    return new Array<string>(chunkCount).fill('')
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length < chunkCount * 3) {
    return [trimmed, ...new Array<string>(chunkCount - 1).fill('')]
  }

  const targetWordsPerChunk = Math.ceil(words.length / chunkCount)
  return Array.from({ length: chunkCount }, (_, index) => {
    const start = index * targetWordsPerChunk
    const end = index === chunkCount - 1 ? words.length : start + targetWordsPerChunk
    return words.slice(start, end).join(' ')
  })
}

function splitShotPlanItem(params: SplitShotPlanItemParams): LongTakeShotPlanItem[] {
  const { forceEmptyAudio, idSuffix, keepFirstShotId, maxDurationSec, shot } = params
  const start = Number(shot.time_range.start)
  const end = Number(shot.time_range.end)
  const duration = end - start

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    duration <= maxDurationSec + SHOT_PLAN_TIMING_EPSILON_SECONDS
  ) {
    const baseShot = forceEmptyAudio ? { ...shot, audio: '' } : shot
    if (!keepFirstShotId) {
      return [{ ...baseShot, shot_id: `${shot.shot_id}_${idSuffix}_1` }]
    }
    return [baseShot]
  }

  const chunkCount = Math.max(1, Math.ceil(duration / maxDurationSec))
  const chunkDuration = duration / chunkCount
  const audioChunks = forceEmptyAudio
    ? new Array<string>(chunkCount).fill('')
    : splitAudioAcrossChunks(shot.audio, chunkCount)

  return Array.from({ length: chunkCount }, (_, index) => {
    const chunkStart = index === 0 ? start : roundShotPlanTime(start + chunkDuration * index)
    const chunkEnd =
      index === chunkCount - 1 ? end : roundShotPlanTime(start + chunkDuration * (index + 1))
    return {
      ...shot,
      audio: audioChunks[index] ?? '',
      shot_id:
        index === 0 && keepFirstShotId ? shot.shot_id : `${shot.shot_id}_${idSuffix}_${index + 1}`,
      time_range: {
        start: chunkStart,
        end: Math.max(chunkStart, chunkEnd),
      },
    }
  })
}
