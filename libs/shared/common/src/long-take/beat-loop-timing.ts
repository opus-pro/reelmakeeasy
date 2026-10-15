/**
 * The beat grid every loop short shares (beat-loop skill): N clips of one 4 s bar each, two
 * beats of HIT and one of FREEZE (0-3 s) that are never retimed, then one beat of CUT. The
 * storyboard checks, the captions, the beat-lock and the overlays all read it from here. Pure
 * constants, so the caption chunker can load them without the model registry.
 */

/** Every clip is one bar of four beats, a second each. */
export const BEAT_CLIP_SECONDS = 4
/** One beat. */
export const BEAT_SECONDS = BEAT_CLIP_SECONDS / 4
/** The hit: beats 1 and 2. */
export const BEAT_HIT_END_SECONDS = 2 * BEAT_SECONDS
/** Hit and freeze: the part of a clip the beat-lock keeps as it is. */
export const BEAT_HOLD_SECONDS = 3 * BEAT_SECONDS
/**
 * How early in the freeze a clip may start its cut: the QA's late-arrival and stray-cut
 * screens stop this far before beat 4 (at 2.9 s).
 */
export const BEAT_CUT_LEAD_SECONDS = 0.1
/** Narration line k starts this far into clip k, so its first word lands on the hit. */
export const BEAT_LINE_OFFSET_SECONDS = 0.15
/** A line's speech must end by this point of its clip, before the cut. */
export const BEAT_SPEECH_END_SECONDS = 3.6
/** Fact stamps show from 0.3 s to 3.0 s of their clip: through the hit and the freeze. */
export const BEAT_STAMP_WINDOW = { end: 3, start: 0.3 } as const
