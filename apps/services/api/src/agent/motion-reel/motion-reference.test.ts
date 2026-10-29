import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { BadReferenceError, checkReference, remotionBrowserPath } from './motion-reference'

describe('remotionBrowserPath', () => {
  it("finds Remotion's headless browser, past the VERSION file beside it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-runtime-'))
    const base = path.join(root, 'node_modules', '.remotion', 'chrome-headless-shell')
    const folder = path.join(base, 'mac-arm64', 'chrome-headless-shell-mac-arm64')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(base, 'VERSION'), '131.0')
    expect(remotionBrowserPath(root)).toBeUndefined()
    fs.writeFileSync(path.join(folder, 'chrome-headless-shell'), '')
    expect(remotionBrowserPath(root)).toBe(path.join(folder, 'chrome-headless-shell'))
  })

  it('is undefined before the runtime is installed', () => {
    expect(remotionBrowserPath(path.join(os.tmpdir(), 'no-such-runtime'))).toBeUndefined()
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
