import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { llmConfig } from './config'
import type { Content } from './types'

const run = promisify(execFile)

const MIME_BY_EXT: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.md': 'text/markdown',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}

export interface Loaded {
  buffer: Buffer
  mimeType: string
}

function mimeFromPath(p: string): string {
  const clean = p.split('?')[0] ?? p
  return MIME_BY_EXT[path.extname(clean).toLowerCase()] ?? 'application/octet-stream'
}

/** Loads a data URI, http(s) URL, local path, or app storage URI into memory. */
export async function loadUri(uri: string): Promise<Loaded> {
  if (uri.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri)
    if (!match) throw new Error('Malformed data URI')
    const [, mime = 'application/octet-stream', b64, data = ''] = match
    return { buffer: Buffer.from(b64 ? data : decodeURIComponent(data), b64 ? 'base64' : 'utf8'), mimeType: mime }
  }
  if (/^https?:\/\//.test(uri)) {
    const res = await fetch(uri)
    if (!res.ok) throw new Error(`Failed to fetch ${uri}: ${res.status}`)
    const header = res.headers.get('content-type')?.split(';')[0]
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType: header && header !== 'application/octet-stream' ? header : mimeFromPath(uri),
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) {
    const resolver = llmConfig().resolveUri
    if (!resolver) throw new Error(`No resolver configured for ${uri}`)
    return loadUri(await resolver(uri))
  }
  return { buffer: await readFile(uri), mimeType: mimeFromPath(uri) }
}

export async function toDataUri(uri: string): Promise<string> {
  if (uri.startsWith('data:')) return uri
  const { buffer, mimeType } = await loadUri(uri)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

/** Samples evenly spaced frames, since the chat protocol has no video input. */
async function videoFrames(uri: string, count = 8): Promise<string[]> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'llm-frames-'))
  try {
    const { buffer } = await loadUri(uri)
    const input = path.join(dir, 'input.mp4')
    await writeFile(input, buffer)
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input,
    ])
    const duration = Math.max(Number(stdout.trim()) || 1, 0.1)
    await run('ffmpeg', [
      '-v', 'error', '-i', input, '-vf', `fps=${count / duration},scale=768:-2`, '-frames:v', String(count),
      path.join(dir, 'frame-%02d.jpg'),
    ])
    const frames = (await readdir(dir)).filter((f) => f.startsWith('frame-')).sort()
    return Promise.all(
      frames.map(async (f) => `data:image/jpeg;base64,${(await readFile(path.join(dir, f))).toString('base64')}`),
    )
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

type ChatPart =
  | { file: { file_data: string; filename: string }; type: 'file' }
  | { image_url: { url: string }; type: 'image_url' }
  | { input_audio: { data: string; format: string }; type: 'input_audio' }
  | { text: string; type: 'text' }

/** Maps app content parts to OpenAI chat message parts. */
export async function toChatParts(contents: Content[] = []): Promise<ChatPart[]> {
  const parts: ChatPart[] = []
  for (const content of contents) {
    switch (content.type) {
      case 'text':
        parts.push({ text: content.text, type: 'text' })
        break
      case 'image_url':
        parts.push({ image_url: { url: await toDataUri(content.imageUrl) }, type: 'image_url' })
        break
      case 'audio_url': {
        const { buffer, mimeType } = await loadUri(content.audioUrl)
        const format = (content.mimeType ?? mimeType).includes('wav') ? 'wav' : 'mp3'
        parts.push({ input_audio: { data: buffer.toString('base64'), format }, type: 'input_audio' })
        break
      }
      case 'video_url':
        for (const url of await videoFrames(content.videoUrl)) parts.push({ image_url: { url }, type: 'image_url' })
        break
      case 'document_url': {
        const { buffer, mimeType } = await loadUri(content.documentUrl)
        const mime = content.mimeType ?? mimeType
        if (mime.startsWith('text/') || mime === 'application/json') {
          parts.push({ text: buffer.toString('utf8'), type: 'text' })
        } else {
          parts.push({
            file: {
              file_data: `data:${mime};base64,${buffer.toString('base64')}`,
              filename: content.filename ?? path.basename(content.documentUrl.split('?')[0] ?? 'document'),
            },
            type: 'file',
          })
        }
        break
      }
    }
  }
  return parts
}
