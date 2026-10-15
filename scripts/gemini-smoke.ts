/**
 * One cheap call per Gemini adapter, to check the request and response shapes
 * against the live Gemini API before a whole video: a picture, a 3 s Omni Flash
 * clip, an 8 s Veo clip, a Lyria clip, a TTS line and a transcription of that
 * line. Omni Flash is the default clip model on Gemini: it goes from one frame
 * to the next at any length from 3 to 10 s. Veo takes a last frame only on 8 s
 * clips, so it is offered in the clip menu and as the fallback. Needs
 * GEMINI_API_KEY (read from .env) and ffmpeg. About $1.25 for all six. Files
 * land in .reelmakeeasy/gemini-smoke/; a failed step prints the API's
 * plain-words error and the script exits non-zero.
 *
 *   pnpm exec tsx --tsconfig tsconfig.base.json scripts/gemini-smoke.ts [image] [veo] [omni] [music] [tts] [transcribe]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { LLM } from '../libs/llm/src'
import { setGenerationProvider } from '../libs/llm/src/registry'
import { geminiTranscribe } from '../libs/shared/common/src/asr/gemini-transcribe'
import { geminiTextToSpeech } from '../libs/shared/common/src/tts/gemini-tts'
import { GEMINI_DEFAULT_VOICE_ID } from '../libs/shared/common/src/tts/gemini-voices'

const OUT = path.resolve(__dirname, '../.reelmakeeasy/gemini-smoke')
const STEPS = ['image', 'veo', 'omni', 'music', 'tts', 'transcribe'] as const
const LINE = 'Did you know honey never goes bad?'

type Step = (typeof STEPS)[number]

const out = (name: string): string => path.join(OUT, name)

async function clip(model: string, seconds: number, file: string): Promise<string> {
  if (!existsSync(out('image.png'))) throw new Error('Run the image step first')
  const frame = dataUri(out('image.png'))
  const result = await LLM.generateVideo({
    aspectRatio: '9:16',
    durationSeconds: seconds,
    firstFrameUrl: frame,
    lastFrameUrl: frame,
    models: [model],
    outputPath: out(file),
    prompt: 'A slow push in on the honey jar as morning light moves across the table.',
    task: 'gemini-smoke',
  })
  return `${result.processedDuration.toFixed(1)} s, ${result.width}x${result.height}, ${out(file)}`
}

/** A data URI for a picture, with its real type (Gemini answers PNG or JPEG). */
function dataUri(file: string): string {
  const bytes = readFileSync(file)
  const type = bytes.subarray(1, 4).toString('ascii') === 'PNG' ? 'image/png' : 'image/jpeg'
  return `data:${type};base64,${bytes.toString('base64')}`
}

async function main(): Promise<void> {
  const envFile = path.resolve(__dirname, '../.env')
  if (existsSync(envFile)) process.loadEnvFile(envFile)
  if (!process.env['GEMINI_API_KEY']) throw new Error('Set GEMINI_API_KEY in .env first')
  setGenerationProvider('google')
  mkdirSync(OUT, { recursive: true })
  const asked = process.argv.slice(2)
  for (const step of STEPS.filter((s) => asked.length === 0 || asked.includes(s))) {
    const started = Date.now()
    try {
      const detail = await run(step)
      console.log(`ok   ${step} (${Math.round((Date.now() - started) / 1000)} s): ${detail}`)
    } catch (error) {
      process.exitCode = 1
      console.log(`FAIL ${step}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function run(step: Step): Promise<string> {
  switch (step) {
    case 'image': {
      const { imageBase64 } = await LLM.generateImageWithMeta({
        aspectRatio: '9:16',
        models: [],
        prompt: 'A jar of golden honey on a wooden kitchen table, morning light, photo.',
        role: 'image.fast',
        task: 'gemini-smoke',
      })
      writeFileSync(out('image.png'), Buffer.from(imageBase64, 'base64'))
      return out('image.png')
    }
    case 'music': {
      const { audioBase64 } = await LLM.generateAudio({
        format: 'mp3',
        models: [],
        prompt: 'Calm acoustic guitar bed for a short explainer.',
        task: 'gemini-smoke',
      })
      writeFileSync(out('music.mp3'), Buffer.from(audioBase64, 'base64'))
      return out('music.mp3')
    }
    case 'omni': {
      return clip('omni-flash-google', 3, 'omni.mp4')
    }
    case 'transcribe': {
      if (!existsSync(out('speech.mp3'))) throw new Error('Run the tts step first')
      const { text, words } = await geminiTranscribe(readFileSync(out('speech.mp3')))
      const timed = words.map((w) => `${w.text}@${w.start ?? '?'}-${w.end ?? '?'}`)
      return `"${text}" ${timed.join(' ')}`
    }
    case 'tts': {
      const { audioBuffer } = await geminiTextToSpeech({
        text: LINE,
        voiceId: GEMINI_DEFAULT_VOICE_ID,
      })
      writeFileSync(out('speech.mp3'), audioBuffer)
      return out('speech.mp3')
    }
    case 'veo': {
      return clip('veo-3.1-fast-google', 8, 'veo.mp4')
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
