import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { presetPackDir } from '../storage/presets'

import { download } from './download'

describe('download from file://', () => {
  const env = { ...process.env }
  let dataDir: string
  let target: string

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelmakeeasy-download-'))
    process.env['DATA_DIR'] = dataDir
    target = path.join(dataDir, 'out', 'file.txt')
  })

  afterEach(() => {
    process.env = { ...env }
    fs.rmSync(dataDir, { force: true, recursive: true })
  })

  it('links a preset pack file in place', async () => {
    const source = path.join(presetPackDir(), 'render', 'a.txt')
    fs.mkdirSync(path.dirname(source), { recursive: true })
    fs.writeFileSync(source, 'preset')

    await download(`file://${source}`, target)

    expect(fs.readFileSync(target, 'utf8')).toBe('preset')
  })

  it('refuses a file outside the preset pack', async () => {
    const secret = path.join(dataDir, 'file-signing.key')
    fs.writeFileSync(secret, 'key')

    await expect(download(`file://${secret}`, target)).rejects.toThrow('Only preset pack files')
    await expect(
      download(`file://${presetPackDir()}/../../file-signing.key`, target),
    ).rejects.toThrow('Only preset pack files')
    expect(fs.existsSync(target)).toBe(false)
  })
})
