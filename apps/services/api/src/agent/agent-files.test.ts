import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  isAllowedImagePath,
  projectFilePath,
  resolveAllowedImagePath,
  resolveImageUnder,
} from './agent-files'

describe('isAllowedImagePath', () => {
  let sessionDir: string
  let outsideDir: string

  beforeEach(() => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-files-session-'))
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-files-outside-'))
  })

  afterEach(() => {
    fs.rmSync(sessionDir, { force: true, recursive: true })
    fs.rmSync(outsideDir, { force: true, recursive: true })
  })

  it('allows a real image inside the session folder', () => {
    const p = path.join(sessionDir, 'a.png')
    fs.writeFileSync(p, '')
    expect(isAllowedImagePath(p, sessionDir)).toBe(true)
  })

  it('allows a webp image directly under the session folder', () => {
    const p = path.join(sessionDir, 'k1.webp')
    fs.writeFileSync(p, '')
    expect(isAllowedImagePath(p, sessionDir)).toBe(true)
  })

  it('refuses a symlink inside the session folder pointing outside the allowed roots', () => {
    const target = path.join(outsideDir, 'secret.png')
    fs.writeFileSync(target, '')
    const link = path.join(sessionDir, 'inside.png')
    fs.symlinkSync(target, link)
    expect(isAllowedImagePath(link, sessionDir)).toBe(false)
  })

  it('allows a symlink inside the session folder pointing to another real image inside it', () => {
    const target = path.join(sessionDir, 'real.png')
    fs.writeFileSync(target, '')
    const link = path.join(sessionDir, 'inside.png')
    fs.symlinkSync(target, link)
    expect(isAllowedImagePath(link, sessionDir)).toBe(true)
  })

  it('refuses a nonexistent path', () => {
    expect(isAllowedImagePath(path.join(sessionDir, 'missing.png'), sessionDir)).toBe(false)
  })

  it('refuses a real image in another folder', () => {
    const p = path.join(outsideDir, 'a.png')
    fs.writeFileSync(p, '')
    expect(isAllowedImagePath(p, sessionDir)).toBe(false)
  })

  it('refuses traversal out of the session folder', () => {
    const p = path.join(outsideDir, 'a.png')
    fs.writeFileSync(p, '')
    const traversal = path.join(sessionDir, '..', path.basename(outsideDir), 'a.png')
    expect(isAllowedImagePath(traversal, sessionDir)).toBe(false)
  })

  it('refuses a non-image extension inside the session folder', () => {
    const p = path.join(sessionDir, 'notes.txt')
    fs.writeFileSync(p, '')
    expect(isAllowedImagePath(p, sessionDir)).toBe(false)
  })

  it('refuses a relative path', () => {
    expect(isAllowedImagePath('relative/a.png', sessionDir)).toBe(false)
  })

  it('returns the realpath of an allowed image, so the checked path is the served one', () => {
    const target = path.join(sessionDir, 'real.png')
    fs.writeFileSync(target, '')
    const link = path.join(sessionDir, 'inside.png')
    fs.symlinkSync(target, link)
    expect(resolveAllowedImagePath(link, sessionDir)).toBe(fs.realpathSync(target))
    expect(resolveAllowedImagePath(path.join(outsideDir, 'x.png'), sessionDir)).toBeNull()
  })

  it('allows images under the given generated_images folder', () => {
    const imagesDir = path.join(outsideDir, 'codex-home', 'generated_images')
    fs.mkdirSync(imagesDir, { recursive: true })
    const p = path.join(imagesDir, 'g.png')
    fs.writeFileSync(p, '')
    expect(isAllowedImagePath(p, sessionDir, imagesDir)).toBe(true)
    // Without imagesDir pointing there, the folder is not an allowed root.
    expect(isAllowedImagePath(p, sessionDir, path.join(outsideDir, 'other-images'))).toBe(false)
  })
})

describe('resolveImageUnder', () => {
  let a: string
  let b: string
  let outside: string

  beforeEach(() => {
    a = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-files-a-'))
    b = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-files-b-'))
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-files-out-'))
  })

  afterEach(() => {
    for (const dir of [a, b, outside]) fs.rmSync(dir, { force: true, recursive: true })
  })

  it('allows a picture under any of the roots, by its real path', () => {
    fs.writeFileSync(path.join(b, 'k2.png'), '')
    // A link inside the first root to a picture in the second (a chat's `project` link).
    fs.symlinkSync(b, path.join(a, 'project'))
    expect(resolveImageUnder(path.join(a, 'project', 'k2.png'), [a, b])).toBe(
      fs.realpathSync(path.join(b, 'k2.png')),
    )
    expect(resolveImageUnder(path.join(a, 'project', 'k2.png'), [a])).toBeNull()
  })

  it('refuses a picture outside the roots, a missing root, a relative path and a non-picture', () => {
    fs.writeFileSync(path.join(outside, 'x.png'), '')
    fs.writeFileSync(path.join(a, 'notes.txt'), '')
    expect(resolveImageUnder(path.join(outside, 'x.png'), [a, b])).toBeNull()
    expect(resolveImageUnder(path.join(outside, 'x.png'), [path.join(a, 'gone')])).toBeNull()
    expect(resolveImageUnder('x.png', [a])).toBeNull()
    expect(resolveImageUnder(path.join(a, 'notes.txt'), [a])).toBeNull()
  })
})

describe('projectFilePath', () => {
  it("names a project file by its path under the working folder's project link", () => {
    expect(projectFilePath('store://projects/p1/long_take/transitions/transition_0-rk7x.mp4')).toBe(
      'project/long_take/transitions/transition_0-rk7x.mp4',
    )
    expect(
      projectFilePath('http://localhost:5017/api/files/projects/p1/long_take/keyframes/2.png'),
    ).toBe('project/long_take/keyframes/2.png')
  })

  it('is null for a file outside the video, or none', () => {
    expect(projectFilePath('store://elsewhere/x.mp4')).toBeNull()
    expect(projectFilePath(undefined)).toBeNull()
  })
})
