import { spawn } from 'node:child_process'

/** The sample rate sound analysis runs at: enough for the timbre of a sound effect. */
export const SOUND_ANALYSIS_RATE = 22_050

/** Decodes any audio (or a video's sound) to mono float samples, with FFmpeg. */
export function decodeAudioMono(
  file: string,
  sampleRate = SOUND_ANALYSIS_RATE,
  maxSec?: number,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        file,
        ...(maxSec ? ['-t', String(maxSec)] : []),
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(sampleRate),
        '-f',
        'f32le',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    )
    const chunks: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (text: string) => (stderr += text))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0)
        return reject(new Error(`ffmpeg could not read ${file}: ${stderr.trim().slice(0, 300)}`))
      const buffer = Buffer.concat(chunks)
      // Copy into an aligned buffer: a Float32Array view needs a 4-byte aligned offset.
      const aligned = new Float32Array(Math.floor(buffer.byteLength / 4))
      for (let i = 0; i < aligned.length; i++) aligned[i] = buffer.readFloatLE(i * 4)
      resolve(aligned)
    })
  })
}
