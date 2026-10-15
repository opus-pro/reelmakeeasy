import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { generateAgentImage, SAVED_IMAGE_PREFIX } from './generate-image'

const PNG = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
const made = async () => ({ imageBase64: PNG, model: 'nano-banana-lite', usage: {} })

describe('generateAgentImage', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ly-img-')))
  })
  afterEach(() => fs.rmSync(dir, { force: true, recursive: true }))

  it('saves the picture under images/ with the next number and says where', async () => {
    const generate = jest.fn(made)
    const r1 = await generateAgentImage({ prompt: 'fox' }, { generate, sessionDir: dir })
    const r2 = await generateAgentImage(
      { aspect_ratio: '1:1', prompt: 'owl' },
      { generate, sessionDir: dir },
    )
    expect(r1).toEqual({
      success: true,
      text: `${SAVED_IMAGE_PREFIX}${path.join(dir, 'images/1.png')}`,
    })
    expect(r2.text).toBe(`${SAVED_IMAGE_PREFIX}${path.join(dir, 'images/2.png')}`)
    expect(fs.readFileSync(path.join(dir, 'images/1.png')).toString('base64')).toBe(PNG)
    expect(generate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        aspectRatio: '9:16',
        contents: [],
        prompt: 'fox',
        role: 'image.agentPreview',
      }),
    )
    expect(generate).toHaveBeenNthCalledWith(2, expect.objectContaining({ aspectRatio: '1:1' }))
  })

  it('passes an earlier preview as the reference, by absolute or session-relative path', async () => {
    fs.mkdirSync(path.join(dir, 'images'))
    fs.writeFileSync(path.join(dir, 'images/1.png'), Buffer.from(PNG, 'base64'))
    const generate = jest.fn(made)
    for (const ref of [path.join(dir, 'images/1.png'), 'images/1.png']) {
      await generateAgentImage(
        { prompt: 'warmer', reference_image: ref },
        { generate, sessionDir: dir },
      )
    }
    for (const [call] of generate.mock.calls as unknown as [{ contents: { imageUrl: string }[] }][])
      expect(call.contents[0]?.imageUrl).toBe(`data:image/png;base64,${PNG}`)
  })

  it.each(['/etc/passwd', '../../.env', 'images/../../x.png', 'notes.txt'])(
    'refuses a reference outside the session or not a picture (%s)',
    async (ref) => {
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'x')
      const generate = jest.fn(made)
      const r = await generateAgentImage(
        { prompt: 'x', reference_image: ref },
        { generate, sessionDir: dir },
      )
      expect(r.success).toBe(false)
      expect(generate).not.toHaveBeenCalled()
    },
  )

  it("once there is a video, takes one of its keyframes (through the chat's project link) to fix", async () => {
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ly-proj-')))
    try {
      fs.mkdirSync(path.join(project, 'long_take', 'keyframes'), { recursive: true })
      fs.writeFileSync(
        path.join(project, 'long_take', 'keyframes', '2.png'),
        Buffer.from(PNG, 'base64'),
      )
      fs.mkdirSync(path.join(dir, 'edit'))
      fs.symlinkSync(project, path.join(dir, 'edit', 'project'))
      const generate = jest.fn(made)
      const opts = {
        generate,
        referenceRoots: [dir, project],
        sessionDir: dir,
        workingDir: path.join(dir, 'edit'),
      }
      const r = await generateAgentImage(
        {
          prompt: 'point with the index finger',
          reference_image: 'project/long_take/keyframes/2.png',
        },
        opts,
      )
      expect(r.success).toBe(true)
      const [[call]] = generate.mock.calls as unknown as [{ contents: { imageUrl: string }[] }][]
      expect(call.contents[0]?.imageUrl).toBe(`data:image/png;base64,${PNG}`)
      // Without the project among the roots, the same picture is refused.
      const refused = await generateAgentImage(
        { prompt: 'x', reference_image: 'project/long_take/keyframes/2.png' },
        { ...opts, referenceRoots: [dir] },
      )
      expect(refused.success).toBe(false)
    } finally {
      fs.rmSync(project, { force: true, recursive: true })
    }
  })

  it('answers a failure in plain words', async () => {
    const generate = jest.fn(async () => {
      throw new Error('fal 422 safety')
    })
    await expect(
      generateAgentImage({ prompt: 'x' }, { generate, sessionDir: dir }),
    ).resolves.toEqual({ success: false, text: "The image couldn't be made: fal 422 safety" })
  })

  it('needs a prompt', async () => {
    const generate = jest.fn(made)
    await expect(generateAgentImage({}, { generate, sessionDir: dir })).resolves.toMatchObject({
      success: false,
    })
    expect(generate).not.toHaveBeenCalled()
  })
})
