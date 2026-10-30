import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { BadReferenceError, checkReference, remotionBrowserPath } from './motion-reference'

describe('remotionBrowserPath', () => {
  /** A runtime with Remotion's browser in it; with `at`, the browser's folder is there and the
   *  runtime links to it. `file` is the browser as the runtime sees it. */
  function installBrowser(at?: string): { base: string; file: string; root: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-runtime-'))
    const base = path.join(root, 'node_modules', '.remotion', 'chrome-headless-shell')
    const real = at ?? base
    fs.mkdirSync(path.join(real, 'mac-arm64', 'chrome-headless-shell-mac-arm64'), {
      recursive: true,
    })
    fs.writeFileSync(path.join(real, 'VERSION'), '131.0')
    fs.writeFileSync(
      path.join(real, 'mac-arm64', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
      'browser 131.0',
    )
    if (at) {
      fs.mkdirSync(path.dirname(base), { recursive: true })
      fs.symlinkSync(at, base, 'junction')
    }
    const file = path.join(
      base,
      'mac-arm64',
      'chrome-headless-shell-mac-arm64',
      'chrome-headless-shell',
    )
    return { base, file, root }
  }

  it("finds Remotion's headless browser, past the VERSION file beside it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-runtime-'))
    const base = path.join(root, 'node_modules', '.remotion', 'chrome-headless-shell')
    const folder = path.join(base, 'mac-arm64', 'chrome-headless-shell-mac-arm64')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(base, 'VERSION'), '131.0')
    expect(remotionBrowserPath(root, null)).toBeUndefined()
    fs.writeFileSync(path.join(folder, 'chrome-headless-shell'), '')
    expect(remotionBrowserPath(root, null)).toBe(path.join(folder, 'chrome-headless-shell'))
  })

  it('is undefined before the runtime is installed', () => {
    expect(remotionBrowserPath(path.join(os.tmpdir(), 'no-such-runtime'), null)).toBeUndefined()
  })

  it('runs the browser from a copy outside the runtime, made once per version', () => {
    const { base, file, root } = installBrowser()
    const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-copies-'))
    const copy = path.join(copies, '131.0', path.relative(base, file))
    expect(remotionBrowserPath(root, copies)).toBe(copy)
    expect(fs.readFileSync(copy, 'utf8')).toBe('browser 131.0')

    fs.writeFileSync(file, 'browser 131.0, changed')
    expect(remotionBrowserPath(root, copies)).toBe(copy)
    expect(fs.readFileSync(copy, 'utf8')).toBe('browser 131.0')

    fs.writeFileSync(path.join(base, 'VERSION'), '132.0\n')
    const next = path.join(copies, '132.0', path.relative(base, file))
    expect(remotionBrowserPath(root, copies)).toBe(next)
    expect(fs.readFileSync(next, 'utf8')).toBe('browser 131.0, changed')
  })

  it('runs the browser where it is when the runtime already links to a copy', () => {
    const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-copies-'))
    const { file, root } = installBrowser(path.join(copies, '131.0'))
    expect(remotionBrowserPath(root, copies)).toBe(file)
    expect(fs.readdirSync(copies)).toEqual(['131.0'])
  })
})

describe('checkReference', () => {
  it('takes YouTube links on YouTube hosts only', () => {
    expect(
      checkReference({ kind: 'youtube', url: ' https://www.youtube.com/watch?v=x ' }).url,
    ).toBe('https://www.youtube.com/watch?v=x')
    expect(() => checkReference({ kind: 'youtube', url: 'http://youtu.be/x' })).toThrow(
      BadReferenceError,
    )
    expect(() =>
      checkReference({ kind: 'youtube', url: 'https://youtube.com.evil.example/x' }),
    ).toThrow(BadReferenceError)
  })

  it('refuses websites on this computer or a private network', () => {
    for (const url of [
      'https://localhost:5017',
      'https://10.0.0.2',
      'https://169.254.169.254/latest',
    ])
      expect(() => checkReference({ kind: 'website', url })).toThrow(BadReferenceError)
  })
})
