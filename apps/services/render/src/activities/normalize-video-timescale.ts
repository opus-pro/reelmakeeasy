import { runFfmpeg } from '@reelmakeeasy/common/utils/cmdline'

// MPEG's conventional 90 kHz clock: exactly divisible by every common frame
// rate (24/25/30/60), so this remux can never round a timestamp. Same value the
// 4K export module normalizes to (activities/export-4k/chunk-video.ts) - keep
// the two in step, a join is only safe when every input agrees.
const COMMON_VIDEO_TIMESCALE = '90000'

/**
 * Remux `inputPath` to `outputPath` on a common video track timescale. Stream
 * copy, container-only: no decode, no re-encode, bit-identical payload.
 *
 * Why: the chunks of one render can carry different mp4 video track
 * timescales (1/16000 next to 1/24000, depending on the encoder build that
 * wrote each one), and the concat demuxer rescales packet timestamps
 * INCORRECTLY across a heterogeneous set: the join silently gains a timestamp
 * gap or drops frames, then passes every container check on the way out.
 *
 * Normalizing here makes that corruption unreachable: heterogeneous inputs are
 * flattened to one timescale before the concat ever sees them. The 4K export
 * module does the same for the same reason (vendor chunks arrive with
 * arbitrary timescales); this brings the shared render concat to parity.
 *
 * Rejects when ffmpeg exits non-zero - the caller must fail the concat rather
 * than fall back to the raw chunk, which would reinstate the corruption
 * silently.
 */
export async function normalizeVideoTimescale(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  await runFfmpeg(
    '-i',
    inputPath,
    '-c',
    'copy',
    '-video_track_timescale',
    COMMON_VIDEO_TIMESCALE,
    outputPath,
  )
}
