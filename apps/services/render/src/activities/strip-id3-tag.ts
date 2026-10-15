import * as fs from 'node:fs'

/**
 * Strips leading ID3v2 tag(s) from an MP3 file in place, returning how many
 * bytes were removed (0 = file untouched).
 *
 * Why: some voice pipelines write voice_over.mp3 with an ID3v2
 * APIC frame (embedded cover art). Demuxers expose that as a SECOND, mjpeg
 * "video" stream, and the concat step silently fails
 * to mux such a file - the concat reports success and the delivery ships
 * with no audio at all. ID3v2 is pure metadata prepended to the MPEG frames,
 * so removing it cannot affect the audio, and a pure-byte strip needs no extra
 * ffmpeg pass.
 */
export function stripLeadingId3Tag(filePath: string): number {
  const data = fs.readFileSync(filePath)
  let offset = 0
  // Multiple consecutive tags are rare but legal; strip them all.
  while (
    data.length >= offset + 10 &&
    data[offset] === 0x49 && // 'I'
    data[offset + 1] === 0x44 && // 'D'
    data[offset + 2] === 0x33 // '3'
  ) {
    // Syncsafe 28-bit size (excludes the 10-byte header; footer adds 10
    // more). Spec requires the high bit CLEAR on every size byte; a set bit
    // means a malformed header, and masking it away would invent a smaller
    // size - the partial strip would leave the file starting mid-metadata.
    // Treat it as malformed and leave the file alone instead.
    if (
      ((data[offset + 6] | data[offset + 7] | data[offset + 8] | data[offset + 9]) & 0x80) !==
      0
    ) {
      break
    }
    const size =
      (data[offset + 6] << 21) |
      (data[offset + 7] << 14) |
      (data[offset + 8] << 7) |
      data[offset + 9]
    const hasFooter = (data[offset + 5] & 0x10) !== 0
    const tagTotal = 10 + size + (hasFooter ? 10 : 0)
    if (tagTotal <= 10 || offset + tagTotal > data.length) {
      // Malformed size: leave the file alone rather than corrupt it.
      break
    }
    offset += tagTotal
  }
  if (offset === 0) {
    return 0
  }
  fs.writeFileSync(filePath, data.subarray(offset))
  return offset
}
