// Kept free of imports so workflow code can pull these in without
// dragging ffmpeg and the logger along.

// Perceptual band: multipliers outside this range read as broken pacing to
// viewers, so we clamp the speed change and fix the residual duration gap
// with a trim (clamped speed still too fast) or a pad (clamped speed still
// too slow) instead of applying the raw multiplier.
export const RETIME_MIN_SPEED_MULTIPLIER = 0.9
export const RETIME_MAX_SPEED_MULTIPLIER = 1.1
