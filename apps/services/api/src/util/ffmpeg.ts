import FfmpegCommand from 'fluent-ffmpeg'

export function getFfmpeg() {
  return FfmpegCommand().addOption('-hide_banner')
}
