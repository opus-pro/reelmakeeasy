import { execFile } from 'node:child_process'

import { ensureError } from '../utils/error-handler'

import type { RenderFinalLogger } from './render-final.types'

// Load-bearing gate, so the budget is generous (-count_packets reads the whole
// mdat); still bounded so a wedged ffprobe fails the render instead of hanging
// the finalize activity until its own timeout.
const VALIDATE_TIMEOUT_MS = 60_000

// The decode scan reads and decodes every frame, so its budget scales with
// content length: software H.264 decode runs well above 5x realtime on the
// finalize pods, so 5 minutes covers the longest long-take deliveries (~6 min)
// with an order of magnitude to spare while still bounding a wedged ffmpeg.
const DECODE_SCAN_TIMEOUT_MS = 300_000

// A healthy encode produces ZERO error-level decoder output (verified against
// known-good deliveries); corrupt bitstreams produce thousands of lines. The
// cap only bounds how much we quote back into the error message and logs.
const DECODE_ERROR_QUOTE_LINES = 3

/**
 * Lines the decode scan must NOT read as bitstream corruption.
 *
 * The scan decodes into `-f null -`, which is a MUXER. These messages come
 * from that muxer complaining about container timestamp ORDER, not from the
 * decoder reporting a damaged payload -- the `-nostats` note above already
 * states the intent that stderr stay decoder-errors-only, and this is the
 * output that leaks past it.
 *
 * A concat whose chunk boundaries carry slight DTS jitter decodes and plays
 * correctly but emits one line per boundary. Counting those failed two paid
 * 4K exports on 2026-08-24 (deterministic, so all four retries burned) while
 * every input chunk had already passed this very scan individually.
 *
 * Deliberately narrow: real corruption emits decoder errors ("error while
 * decoding", "Invalid NAL unit size", "no frame") ALONGSIDE any timestamp
 * noise, and those still fail. A file whose ONLY complaint is timestamp order
 * decoded cleanly by definition -- that is what the null muxer just proved.
 */
const MUXER_TIMESTAMP_NOISE = [
  /non[- ]monotonic(ally)? increasing dts/i,
  /Application provided invalid, non monotonically increasing dts/i,
  /Invalid (DTS|PTS): .* changing to/i,
]

interface FfprobeValidationOutput {
  format?: { duration?: string }
  streams?: { codec_name?: string; codec_type?: string; nb_read_packets?: string }[]
}

/** True when the line is muxer timestamp noise rather than a decode error. */
function isMuxerTimestampNoise(line: string): boolean {
  return MUXER_TIMESTAMP_NOISE.some((re) => re.test(line))
}

/** The delivered video failed the pre-upload ffprobe integrity check. */
export class DeliveredVideoInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeliveredVideoInvalidError'
  }
}

/**
 * Assert the video we are about to deliver is actually playable
 * BEFORE it reaches the CDN and auto-post. A render pod killed mid-write can
 * leave a complete-looking stored file whose mp4 was never finalized (no moov
 * atom, mdat size 0) -- YouTube accepts such an upload, then fails processing
 * and removes the video, while our side shows "posted".
 *
 * Unlike probeVideoDimensions this check is load-bearing: any failure throws
 * so the finalize activity fails loud (and can retry) instead of shipping a
 * corrupt artifact. Requires a decodable container with at least one video
 * stream, at least one readable packet (-count_packets, so a moov-only shell
 * with an empty mdat cannot pass), and a positive duration.
 */
export async function assertDeliveredVideoPlayable(
  videoPath: string,
  logger: RenderFinalLogger,
  projectId: string,
  opts?: {
    /**
     * Also run a full decode pass (`ffmpeg -f null`) over the file.
     * The ffprobe phase above only proves the CONTAINER is sound -- a file
     * whose H.264 payload is garbage (invalid NAL sizes from a corrupt render
     * chunk) still demuxes cleanly, passes every container check, then
     * glitches or freezes for the user. A decode pass catches that class.
     * Opt-in because it reads and decodes the entire file (seconds, not
     * milliseconds); the delivery choke point in finalizeRender wants it,
     * cheaper probe-only callers may not. Disabling is a one-line call-site
     * revert if the scan ever misbehaves in production.
     */
    decodeScan?: boolean
    /**
     * Also require at least one AUDIO stream. Story-mode compositions always
     * carry the voiceover track, so a silent delivery is always a mux defect
     * (a regression shipped two 4K instances that reported success; the 1080p
     * gate was video-only and would have passed them). Opt-in because this
     * validator also serves artifacts that are legitimately silent.
     */
    requireAudioStream?: boolean
  },
): Promise<void> {
  // Explicitly annotated so TS control-flow analysis treats calls as
  // terminating (never-call narrowing requires a declared type).
  const fail: (reason: string) => never = (reason) => {
    logger.error(
      `[long-take] Delivered video failed validation projectId=${projectId} path=${videoPath} reason=${reason}`,
    )
    throw new DeliveredVideoInvalidError(
      `Delivered video failed validation (${reason}); refusing to publish projectId=${projectId}`,
    )
  }

  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        // All streams (not -select_streams v:0): the audio assertion needs to
        // see every stream; the video checks below pick the video one.
        '-count_packets',
        '-show_entries',
        'stream=codec_name,codec_type,nb_read_packets:format=duration',
        '-of',
        'json',
        videoPath,
      ],
      { encoding: 'utf8', timeout: VALIDATE_TIMEOUT_MS },
      (error, out) => (error ? reject(ensureError(error)) : resolve(out)),
    )
  }).catch((error: Error) => fail(`ffprobe failed: ${error.message}`))

  const probe = ((): FfprobeValidationOutput => {
    try {
      return JSON.parse(stdout) as FfprobeValidationOutput
    } catch {
      return fail(`unparsable ffprobe output: ${stdout.slice(0, 200)}`)
    }
  })()

  const streams = probe.streams ?? []
  // codec_type is absent from very old ffprobe output; treat untyped streams
  // as video so the pre-existing single-stream fixtures keep their meaning.
  const stream = streams.find((s) => (s.codec_type ?? 'video') === 'video')
  if (!stream?.codec_name) {
    fail('no video stream')
  }
  const packets = Number.parseInt(stream.nb_read_packets ?? '', 10)
  if (!Number.isFinite(packets) || packets <= 0) {
    fail(`no readable video packets: ${stream.nb_read_packets}`)
  }
  const durationSec = Number.parseFloat(probe.format?.duration ?? '')
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    fail(`invalid container duration: ${probe.format?.duration}`)
  }
  if (opts?.requireAudioStream && !streams.some((s) => s.codec_type === 'audio')) {
    fail('no audio stream')
  }

  if (!opts?.decodeScan) {
    return
  }

  // Decode phase: decode every stream to /dev/null and treat ANY
  // error-level decoder output (or a non-zero exit) as a corrupt delivery.
  // Decode errors do not reliably flip ffmpeg's exit code, so stderr content
  // is the primary signal; the exit code catches hard failures and timeouts.
  const decodeStart = Date.now()
  const decode = await new Promise<{ error: Error | null; stderr: string }>((resolve) => {
    execFile(
      'ffmpeg',
      // -nostats: progress lines go to stderr on some ffmpeg builds regardless
      // of loglevel; stderr must stay decoder-errors-only for the check below.
      //
      // -map 0:v? / 0:a?: without an explicit map ffmpeg's default selection
      // decodes at most ONE stream per type, so a corrupt second video or audio
      // track would decode clean and publish. The `?` keeps each optional, so a
      // video-only delivery still scans instead of failing on a missing audio
      // map. Subtitle/data streams are deliberately out of scope - they do not
      // affect playback and the null muxer rejects some of them.
      [
        '-v',
        'error',
        '-nostats',
        '-nostdin',
        '-i',
        videoPath,
        '-map',
        '0:v?',
        '-map',
        '0:a?',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8', timeout: DECODE_SCAN_TIMEOUT_MS },
      // stderr is TYPED as string but execFile yields undefined when the child
      // wrote none, and a Buffer under some encoding paths. Taken as unknown so
      // the runtime guard is expressible - narrowing off the declared `string`
      // leaves `never` in the else. Normalised here rather than at the use
      // site: an unguarded .split() threw a TypeError INSIDE the publish path,
      // which fails a delivery over a clean decode.
      (error: Error | null, _stdout: unknown, stderr: unknown) =>
        resolve({
          error: error ? ensureError(error) : null,
          stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
        }),
    )
  })

  const stderrLines = decode.stderr.split('\n').filter((line) => line.trim().length > 0)
  // Split, do not merely count: the muxer lines are surfaced in the clean-scan
  // log so a genuine regression in concat timestamps stays visible instead of
  // being silently tolerated.
  const mutedLines = stderrLines.filter(isMuxerTimestampNoise)
  const errorLines = stderrLines.filter((line) => !isMuxerTimestampNoise(line))
  if (decode.error || errorLines.length > 0) {
    const quoted = errorLines.slice(0, DECODE_ERROR_QUOTE_LINES).join(' | ')
    const reasonParts = [
      `decode scan found a corrupt bitstream: ${errorLines.length} decoder error line(s)`,
    ]
    if (decode.error) {
      reasonParts.push(`ffmpeg: ${decode.error.message}`)
    }
    if (quoted) {
      reasonParts.push(`first: ${quoted}`)
    }
    fail(reasonParts.join('; '))
  }
  logger.info(
    `[long-take] Delivered video decode scan clean projectId=${projectId} durationSec=${durationSec} scanMs=${Date.now() - decodeStart}${
      mutedLines.length > 0
        ? ` mutedMuxerTimestampLines=${mutedLines.length} first=${mutedLines[0]}`
        : ''
    }`,
  )
}
