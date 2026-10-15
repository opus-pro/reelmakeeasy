import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'

import { fitKeyframePicture, resolveKeyframePicture } from './keyframe-picture'

const KEYFRAME = { height: 1360, width: 768 }

const picture = (width: number, height: number, format: 'jpeg' | 'png' = 'png') =>
  sharp({ create: { background: '#808080', channels: 3, height, width } })
    .toFormat(format)
    .toBuffer()

const sizeOf = async (png: Buffer) => {
  const meta = await sharp(png).metadata()
  return { format: meta.format, height: meta.height, width: meta.width }
}

describe('fitKeyframePicture', () => {
  it("fits Codex's edit of a keyframe (943x1668) to the keyframe's exact size", async () => {
    const fitted = await fitKeyframePicture(await picture(943, 1668), KEYFRAME)
    if ('error' in fitted) throw new Error(fitted.error)
    expect(await sizeOf(fitted.png)).toEqual({ format: 'png', height: 1360, width: 768 })
    expect(fitted).toMatchObject({ changed: 'resized', height: 1360, width: 768 })
  })

  it('keeps a picture of the right size as it is, and makes a JPEG a PNG', async () => {
    const same = await fitKeyframePicture(await picture(768, 1360, 'jpeg'), KEYFRAME)
    if ('error' in same) throw new Error(same.error)
    expect(same.changed).toBe('none')
    expect(await sizeOf(same.png)).toEqual({ format: 'png', height: 1360, width: 768 })
  })

  it('crops a picture a little off the shape (9:16 for a 768x1360 keyframe)', async () => {
    const fitted = await fitKeyframePicture(await picture(1080, 1920), KEYFRAME)
    if ('error' in fitted) throw new Error(fitted.error)
    expect(fitted.changed).toBe('cropped')
    expect(await sizeOf(fitted.png)).toMatchObject({ height: 1360, width: 768 })
  })

  it('refuses another shape in plain words, naming both shapes', async () => {
    const square = await fitKeyframePicture(await picture(1024, 1024), KEYFRAME)
    expect(square).toEqual({ error: expect.stringContaining('1024x1024 (1:1)') })
    expect((square as { error: string }).error).toContain('768x1360 (9:16)')
    const wide = await fitKeyframePicture(await picture(1536, 1024), KEYFRAME)
    expect((wide as { error: string }).error).toContain('(3:2)')
    // 2:3 is 18% wider than this keyframe: cropping it would cut the sides of the picture off.
    expect(await fitKeyframePicture(await picture(1024, 1536), KEYFRAME)).toHaveProperty('error')
  })

  it('refuses a picture too small to fill the keyframe sharply', async () => {
    const small = await fitKeyframePicture(await picture(360, 640), KEYFRAME)
    expect(small).toEqual({ error: expect.stringContaining('too small') })
  })

  it('refuses a file that is not a picture', async () => {
    const fitted = await fitKeyframePicture(Buffer.from('not a picture'), KEYFRAME)
    expect(fitted).toEqual({ error: expect.stringContaining("isn't a picture") })
  })
})

describe('resolveKeyframePicture', () => {
  let root: string
  let codexImages: string
  let session: string
  let project: string
  let outside: string

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kf-pic-')))
    codexImages = path.join(root, 'codex-home', 'generated_images', 'thread-1')
    session = path.join(root, 'agent', 's1')
    project = path.join(root, 'files', 'projects', 'p1')
    outside = path.join(root, 'elsewhere')
    for (const dir of [codexImages, path.join(session, 'edit', 'frames'), project, outside])
      fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(path.join(project, 'long_take', 'keyframes'), { recursive: true })
    fs.symlinkSync(project, path.join(session, 'edit', 'project'))
    for (const file of [
      path.join(codexImages, 'exec-1.png'),
      path.join(session, 'edit', 'frames', '2-corrected.png'),
      path.join(project, 'long_take', 'keyframes', '3.png'),
      path.join(outside, 'secret.png'),
    ])
      fs.writeFileSync(file, '')
  })

  afterEach(() => fs.rmSync(root, { force: true, recursive: true }))

  const opts = () => ({
    roots: [path.join(root, 'codex-home', 'generated_images'), session, project],
    workingDir: path.join(session, 'edit'),
  })

  it("takes Codex's saved image, a frame in the chat's folder and a picture in the project", () => {
    expect(resolveKeyframePicture(path.join(codexImages, 'exec-1.png'), opts())).toBe(
      path.join(codexImages, 'exec-1.png'),
    )
    expect(resolveKeyframePicture('frames/2-corrected.png', opts())).toBe(
      path.join(session, 'edit', 'frames', '2-corrected.png'),
    )
    expect(resolveKeyframePicture('project/long_take/keyframes/3.png', opts())).toBe(
      path.join(project, 'long_take', 'keyframes', '3.png'),
    )
  })

  it('refuses a picture anywhere else, a missing one and a way out of the folder', () => {
    expect(resolveKeyframePicture(path.join(outside, 'secret.png'), opts())).toBeNull()
    expect(resolveKeyframePicture('frames/missing.png', opts())).toBeNull()
    expect(resolveKeyframePicture('../../../elsewhere/secret.png', opts())).toBeNull()
  })
})
