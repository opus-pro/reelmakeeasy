import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { MotionReelSetup } from '@reelmakeeasy/common/motion-reel/reel-config'

import { prepareReelProject, REEL_DIR } from './motion-project'

const setup: MotionReelSetup = {
  lengthSec: 15,
  music: { source: 'none' },
  ratio: '16:9',
  styleId: 'hud-showreel',
  subject: 'ReelMakeEasy',
}

describe('prepareReelProject (the template)', () => {
  let workspace: string
  let src: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-template-'))
    src = path.join(workspace, REEL_DIR, 'src')
    fs.mkdirSync(path.join(src, 'scenes'), { recursive: true })
    // A reel set up before the current helpers: stale ReelMakeEasy files, and the agent's own work.
    fs.writeFileSync(path.join(src, 'grid.ts'), '// old clock\n')
    fs.writeFileSync(path.join(src, 'kit.tsx'), '// old kit\n')
    fs.writeFileSync(path.join(src, 'Reel.tsx'), "// the agent's reel\n")
    fs.writeFileSync(path.join(src, 'scenes', 'Intro.tsx'), '// a scene\n')
    fs.writeFileSync(path.join(workspace, REEL_DIR, 'style.md'), '# the style\n')
  })

  afterEach(() => fs.rmSync(workspace, { force: true, recursive: true }))

  it("refreshes its own source files when only the music changes, and keeps the agent's", async () => {
    await prepareReelProject({ music: null, musicOnly: true, setup, workspace })
    // The repo's template (this file is six folders below the repo root).
    const template = path.resolve(__dirname, '../../../../../../presets/motion-reel/template/src')
    for (const file of ['grid.ts', 'kit.tsx', 'transitions.tsx', 'Root.tsx', 'index.ts'])
      expect(fs.readFileSync(path.join(src, file), 'utf8')).toBe(
        fs.readFileSync(path.join(template, file), 'utf8'),
      )
    expect(fs.readFileSync(path.join(src, 'Reel.tsx'), 'utf8')).toBe("// the agent's reel\n")
    expect(fs.readFileSync(path.join(src, 'scenes', 'Intro.tsx'), 'utf8')).toBe('// a scene\n')
    // The rest of the project (style card, package files, links) is left as it was.
    expect(fs.readFileSync(path.join(workspace, REEL_DIR, 'style.md'), 'utf8')).toBe(
      '# the style\n',
    )
    expect(fs.existsSync(path.join(workspace, REEL_DIR, 'package.json'))).toBe(false)
    expect(fs.existsSync(path.join(workspace, REEL_DIR, 'node_modules'))).toBe(false)
  })
})
