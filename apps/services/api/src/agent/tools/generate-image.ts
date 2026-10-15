import fs from 'node:fs'
import path from 'node:path'

import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { LLM } from '@reelmakeeasy/llm'

import { resolveImageUnder } from '../agent-files'

import type { ToolCallResult } from './agent-tools'

/** How a saved picture's path starts the tool's answer (the chat's image card reads it). */
export const SAVED_IMAGE_PREFIX = 'Saved the image to '

const RATIOS = new Set(['1:1', '3:4', '4:5', '9:16', '16:9'])
const MIME: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

type Generate = typeof LLM.generateImageWithMeta

/** The reference picture as a data URI, or null when it isn't a picture under one of `roots`. A
 *  relative path is read from `cwd`. */
function referenceUri(ref: string, cwd: string, roots: string[]): null | string {
  const allowed = resolveImageUnder(path.resolve(cwd, ref), roots)
  if (!allowed) return null
  const mime = MIME[path.extname(allowed).toLowerCase()] ?? 'image/png'
  return `data:${mime};base64,${fs.readFileSync(allowed).toString('base64')}`
}

/** Saves the picture as the session's next `images/<n>.png`. */
function savePicture(sessionDir: string, imageBase64: string): string {
  const dir = path.join(sessionDir, 'images')
  fs.mkdirSync(dir, { recursive: true })
  const n = fs.readdirSync(dir).filter((f) => /^\d+\.png$/.test(f)).length + 1
  const file = path.join(dir, `${n}.png`)
  fs.writeFileSync(file, Buffer.from(imageBase64, 'base64'))
  return file
}

/**
 * `generate_image` (Claude chats): one picture from the `image.agentPreview` model (Nano Banana
 * Lite on fal, Nano Banana 2 Lite on Gemini), saved under the session folder. A reference must be
 * a picture inside that folder, or, once the chat has a video, under `referenceRoots` (the chat's
 * folder and the video's project folder, so a keyframe can be the picture to fix; a relative
 * path is read from `workingDir`). So a prompt-injected path can't send another file out.
 */
export async function generateAgentImage(
  args: unknown,
  opts: {
    generate?: Generate
    referenceRoots?: string[]
    sessionDir: string
    workingDir?: string
  },
): Promise<ToolCallResult> {
  const a = (args ?? {}) as { aspect_ratio?: unknown; prompt?: unknown; reference_image?: unknown }
  const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : ''
  if (!prompt) return { success: false, text: 'generate_image needs a prompt.' }
  const ratio =
    typeof a.aspect_ratio === 'string' && RATIOS.has(a.aspect_ratio) ? a.aspect_ratio : '9:16'
  const contents: { imageUrl: string; type: 'image_url' }[] = []
  if (typeof a.reference_image === 'string' && a.reference_image.trim()) {
    const uri = referenceUri(
      a.reference_image.trim(),
      opts.workingDir ?? opts.sessionDir,
      opts.referenceRoots ?? [opts.sessionDir],
    )
    if (!uri)
      return {
        success: false,
        text: opts.referenceRoots
          ? "reference_image must be a picture from this chat (a path generate_image returned, or a frame you pulled) or one of the video's pictures in project/."
          : 'reference_image must be a picture from this chat (a path generate_image returned).',
      }
    contents.push({ imageUrl: uri, type: 'image_url' })
  }
  try {
    const { imageBase64 } = await (opts.generate ?? LLM.generateImageWithMeta)({
      aspectRatio: ratio,
      contents,
      models: [],
      prompt,
      role: 'image.agentPreview',
      task: 'agent-preview-image',
    })
    return {
      success: true,
      text: `${SAVED_IMAGE_PREFIX}${savePicture(opts.sessionDir, imageBase64)}`,
    }
  } catch (error) {
    return { success: false, text: `The image couldn't be made: ${ensureError(error).message}` }
  }
}
