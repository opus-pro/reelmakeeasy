/**
 * Makes the Gemini voice previews in presets/voice-over/previews, one MP3 per
 * Gemini preset, through the app's own Gemini TTS client (the `tts.gemini`
 * role, the same request the narration sends). Needs GEMINI_API_KEY (read from
 * .env) and ffmpeg; all 30 cost about one cent. Existing files are kept unless
 * --force; pass preset ids to make only those.
 *
 *   pnpm exec tsx --tsconfig tsconfig.base.json scripts/make-gemini-voice-previews.ts [--force] [gemini-kore ...]
 */
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { geminiTextToSpeech } from '../libs/shared/common/src/tts/gemini-tts'
import { GEMINI_PRESET_VOICES } from '../libs/shared/common/src/tts/gemini-voices'

const TEXT = "Hi! This is how I'll tell your story. Let's make something people remember."
const OUT_DIR = path.resolve(__dirname, '../presets/voice-over/previews')

async function main(): Promise<void> {
  const envFile = path.resolve(__dirname, '../.env')
  if (existsSync(envFile)) process.loadEnvFile(envFile)
  if (!process.env['GEMINI_API_KEY']) throw new Error('Set GEMINI_API_KEY in .env first')
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const only = new Set(args.filter((arg) => !arg.startsWith('--')))
  for (const voice of GEMINI_PRESET_VOICES) {
    const out = path.join(OUT_DIR, `preview-${voice.id}.mp3`)
    if ((only.size > 0 && !only.has(voice.id)) || (existsSync(out) && !force)) continue
    const { audioBuffer } = await geminiTextToSpeech({ text: TEXT, voiceId: voice.id })
    writeFileSync(out, audioBuffer)
    console.log(`Wrote ${path.relative(process.cwd(), out)}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
