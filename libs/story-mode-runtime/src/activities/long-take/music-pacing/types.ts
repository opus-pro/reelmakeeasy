/**
 * Music-pacing module - shared contract.
 *
 * A `BeatGrid` is the output of musical analysis (librosa / madmom; produced by a future
 * analysis activity). It is intentionally engine-agnostic. The pacing layer turns a BeatGrid +
 * a timestamped transcript into a `LongTakeBeatSheetOutput` whose cuts land on real beats.
 *
 * This module is currently DORMANT - pure functions + tests only, not wired into any workflow.
 */

export type AudioRegion = {
  end: number
  kind: RegionKind
  start: number
}

export type BeatGrid = {
  /** coefficient of variation of inter-beat intervals; < ~0.15 => steady/clearly rhythmic */
  beatRegularityCv: number
  /** beat onset times in seconds (ascending) */
  beats: number[]
  /** estimated global tempo */
  bpm: number
  /** downbeat (bar-start) times in seconds (ascending); a subset of `beats` */
  downbeats: number[]
  /** total audio duration in seconds */
  durationSec: number
  /** RMS energy envelope, sampled at a fixed hop */
  energy: EnergySample[]
  /** which engine produced this grid */
  engine?: 'librosa' | 'madmom'
  /** heuristic: steady beat + sufficient duration => treat as music */
  isMusic: boolean
  /** percussive onset times in seconds (ascending) */
  onsets: number[]
  /** structural sections; empty array if not computed */
  sections: MusicSection[]
}

export type BeatGridPacingOptions = {
  /** a shot start counts as on-beat if within this tolerance (s) of a beat */
  beatToleranceSec: number
  /** energy percentile (0..1) used to normalize per-section energy when weighting the budget */
  highEnergyPercentile: number
  /** gap (s) between consecutive words above which we split into a new sung "line" */
  lineGapSec: number
  /** never hold a single shot longer than this (s) - Veo's ~10s upper bound */
  maxHoldSec: number
  /**
   * Upper bound on the per-section cadence budget (cost lever). Forced cuts - section/region
   * boundaries and maxHold splits - take precedence, so the final shot count can exceed this
   * when maxHoldSec is small or there are many sections.
   */
  maxShots: number
  /** minimum shot duration (s) - cost floor + Veo's ~2s lower bound */
  minShotSec: number
  /** target cuts per minute - sets the global shot budget (the primary cost lever) */
  targetShotsPerMin: number
}

export type EnergySample = {
  /** RMS energy, normalized to 0..1 across the track */
  rms: number
  /** time in seconds */
  t: number
}

/**
 * Output of the YAMNet music-vs-speech detector (python/music_pacing/music_detector.py).
 * Produced by the detectIfMusic activity. The vocal-gender fields are a validation-only signal
 * logged alongside Gemini's perceivedGender on `project.long_take.completed`.
 */
export type MusicDetection = {
  /** total audio duration in seconds */
  durationSec: number
  /** Validation-only: aggregated AudioSet female-vocal score (0..1). */
  femaleScore?: number
  /** Validation-only: confidence of the winning vocal-gender side (0..1). */
  genderConfidence?: number
  /** musicProbability > threshold (default 0.3; env MUSIC_DETECTOR_THRESHOLD) */
  isMusic: boolean
  /** Validation-only: aggregated AudioSet male-vocal score (0..1). */
  maleScore?: number
  /** which model produced this detection (e.g. 'yamnet') */
  model: string
  /** aggregated AudioSet music-class probability (0..1) */
  musicProbability: number
  /** aggregated AudioSet speech-class probability (0..1) */
  speechProbability: number
  /** top-scoring AudioSet classes (up to 5), highest first */
  topClasses: MusicDetectionClass[]
  /**
   * Validation-only perceived vocal gender from the SAME YAMNet inference (Male/Female singing +
   * speech AudioSet classes). 'unknown' below the gender threshold. Never feeds the pipeline.
   */
  vocalGender?: 'female' | 'male' | 'unknown'
}

export type MusicDetectionClass = {
  label: string
  score: number
}

export type MusicSection = {
  end: number
  /** optional structural label (verse / chorus / drop / ...); may be absent */
  label?: string
  start: number
}

export type RegionKind = 'sung' | 'wordless-break' | 'wordless-intro' | 'wordless-outro'

export const DEFAULT_BEATGRID_PACING_OPTIONS: BeatGridPacingOptions = {
  beatToleranceSec: 0.09,
  highEnergyPercentile: 0.6,
  lineGapSec: 0.7,
  maxHoldSec: 8,
  maxShots: 80,
  minShotSec: 2,
  targetShotsPerMin: 12,
}
