import type { ProjectVoiceOverJson } from '@shared/types/api/project'

import { parseVoiceOverJson } from './projects-lifecycle.util'

const FILES = 'http://localhost:5017/api/files'

describe('parseVoiceOverJson', () => {
  const env = { ...process.env }
  beforeEach(() => {
    delete process.env['PUBLIC_FILES_URL']
    delete process.env['PORT']
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it("keeps a just-made clone's preview as its address, not the URL the browser sent", async () => {
    // Right after a clone is made, the web sends the preview URL it played.
    const sent = {
      name: 'My voice',
      previewAudioUrl: `${FILES}/voice-clones/u1/previews/preview-v1.mp3`,
      type: 'voice-cloned',
      voiceCloneId: 'c1',
      voiceId: 'v1',
      voiceProfile: { gender: 'female' },
    } as unknown as ProjectVoiceOverJson
    expect(await parseVoiceOverJson(sent, {} as never)).toEqual({
      ...sent,
      previewAudioUrl: 'store://voice-clones/u1/previews/preview-v1.mp3',
    })
  })

  it('keeps a preset preview as its address, and anything else as sent', async () => {
    const preset = {
      name: 'Kore',
      previewAudioUrl: 'http://localhost:5017/api/presets/voices/kore.mp3',
      type: 'voice-over',
      voiceId: 'gemini-kore',
    } as ProjectVoiceOverJson
    expect((await parseVoiceOverJson(preset, {} as never)).previewAudioUrl).toBe(
      'preset://voices/kore.mp3',
    )
    const elsewhere = { ...preset, previewAudioUrl: 'https://example.test/kore.mp3' }
    expect(await parseVoiceOverJson(elsewhere, {} as never)).toEqual(elsewhere)
  })
})
