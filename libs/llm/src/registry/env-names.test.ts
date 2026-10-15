import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { applyEnvOverrides, findModelsFile, roleEnvVar } from './load'
import { defaultRegistry, quietLogger } from './test-helpers'

describe('setting names', () => {
  it('names a role variable after the role alone', () => {
    expect(roleEnvVar('video.firstLast')).toBe('VIDEO_FIRSTLAST_MODEL')
    expect(roleEnvVar('chat.pro')).toBe('CHAT_PRO_MODEL')
  })

  it('reads a role variable by its name alone', () => {
    const logger = quietLogger()
    const registry = applyEnvOverrides(
      defaultRegistry(),
      { MUSIC_MODEL: 'lyria2', VIDEO_FIRSTLAST_MODEL: 'veo-3.1-fast' },
      logger,
    )
    expect(registry.roles['video.firstLast']).toBe('veo-3.1-fast')
    expect(registry.roles['music']).toBe('lyria2')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  describe('the models file', () => {
    let dir: string
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-file-'))
      fs.writeFileSync(path.join(dir, 'mine.json'), '{}')
    })
    afterEach(() => fs.rmSync(dir, { force: true, recursive: true }))

    it('is MODELS_FILE', () => {
      expect(findModelsFile(dir, { MODELS_FILE: 'mine.json' })).toBe(path.join(dir, 'mine.json'))
    })

    it('names the variable it read when the file is missing', () => {
      expect(() => findModelsFile(dir, { MODELS_FILE: 'gone.json' })).toThrow(
        /^MODELS_FILE points at/,
      )
    })
  })
})
