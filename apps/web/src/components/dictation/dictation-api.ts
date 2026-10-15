import type { DictationEngine, DictationSetting, DictationStatus } from '@shared/types/api/setup'

import type { FetchApiDomain } from '@/hooks/useApi'

/** `GET /api/speech/dictation`: the engine voice typing uses and every engine's availability. */
export async function getDictationStatus(fetchApiDomain: FetchApiDomain): Promise<DictationStatus> {
  const res = await fetchApiDomain<DictationStatus>('/api/speech/dictation', {
    method: 'GET',
    noThrowError: true,
  })
  if (!res.ok || !res.data) throw new Error(res.error || "Couldn't check voice typing")
  return res.data
}

/** `PUT /api/speech/dictation`: saves the choice and returns the new status. */
export async function setDictationSetting(
  fetchApiDomain: FetchApiDomain,
  setting: DictationSetting,
): Promise<DictationStatus> {
  const res = await fetchApiDomain<DictationStatus>('/api/speech/dictation', {
    data: { setting },
    method: 'PUT',
    noThrowError: true,
  })
  if (!res.ok || !res.data) throw new Error(res.error || "Couldn't save the voice typing choice")
  return res.data
}

/** `POST /api/speech/transcribe`: the text in a recording. */
export async function transcribeRecording(
  fetchApiDomain: FetchApiDomain,
  audio: Blob,
  engine?: DictationEngine,
): Promise<{ engine: DictationEngine; text: string }> {
  const res = await fetchApiDomain<{ engine: DictationEngine; text: string }>(
    '/api/speech/transcribe',
    {
      data: { audio: await toBase64(audio), ...(engine ? { engine } : {}) },
      method: 'POST',
      noThrowError: true,
      timeout: 90_000,
    },
  )
  if (!res.ok || !res.data) throw new Error(res.error || "Couldn't turn that into text")
  return res.data
}

/** `POST /api/speech/prewarm`: loads Whisper ahead of a recording when it's in use. */
export async function prewarmDictation(fetchApiDomain: FetchApiDomain): Promise<void> {
  await fetchApiDomain('/api/speech/prewarm', { method: 'POST', noThrowError: true })
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
