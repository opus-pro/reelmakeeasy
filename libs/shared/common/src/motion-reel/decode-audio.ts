import { spawn } from 'node:child_process'

import { ANALYSIS_SAMPLE_RATE } from './beat-grid'

/** Decodes any audio (or a video's sound) to mono float samples at the analysis rate, with FFmpeg. */
export function decodeAudioMono(
  file: string,
  sampleRate = ANALYSIS_SAMPLE_RATE,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-'],
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

/** Root-mean-square level of the samples between two times (seconds): how loud that stretch is. */
export function rmsBetween(
  samples: Float32Array,
  from: number,
  to: number,
  sampleRate = ANALYSIS_SAMPLE_RATE,
): number {
  const start = Math.max(0, Math.floor(from * sampleRate))
  const end = Math.min(samples.length, Math.floor(to * sampleRate))
  let sum = 0
  for (let i = start; i < end; i++) sum += (samples[i] ?? 0) ** 2
  return end > start ? Math.sqrt(sum / (end - start)) : 0
}
