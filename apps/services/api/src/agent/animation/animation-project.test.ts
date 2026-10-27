import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AgentAnimationSetup } from '@shared/types/api/agent'

import { ANIMATION_DIR, prepareAnimationProject } from './animation-project'

const setup2d: AgentAnimationSetup = {
  lengthSec: 30,
  lookId: '2d',
  music: { source: 'none' },
  subject: 'Why honey never spoils',
}

describe('prepareAnimationProject', () => {
  let workspace: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'animation-project-'))
  })

  afterEach(() => fs.rmSync(workspace, { force: true, recursive: true }))

  it("lays out a 2D project with the shared kit and the 2D look's library", async () => {
    const { projectDir, spec } = await prepareAnimationProject({
      music: null,
      setup: setup2d,
      workspace,
    })
    expect(projectDir).toBe(path.join(workspace, ANIMATION_DIR))
    expect(spec).toEqual({
      fps: 30,
      height: 1920,
      lengthSec: 30,
      lookId: '2d',
      musicFile: null,
      subject: 'Why honey never spoils',
      voiceFile: null,
      width: 1080,
    })
    for (const file of [
      'package.json',
      'tsconfig.json',
      'src/index.ts',
      'src/Root.tsx',
      'src/clock.ts',
      'src/kit.tsx',
      'src/Animation.tsx',
      'src/toon/index.ts',
      'brief.md',
      'look.md',
      'public/animation.json',
      'public/voice/lines.json',
    ])
      expect(fs.existsSync(path.join(projectDir, file))).toBe(true)
    // Only the chosen look's library.
    expect(fs.existsSync(path.join(projectDir, 'src/pixel'))).toBe(false)
    expect(
      JSON.parse(fs.readFileSync(path.join(projectDir, 'public/voice/lines.json'), 'utf8')),
    ).toEqual([])
    expect(fs.readFileSync(path.join(projectDir, 'look.md'), 'utf8')).toContain(
      'reelmakeeasy-animation-2d',
    )
  })

  it("keeps Claude's scenes and starter, and voices, when set up again", async () => {
    const { projectDir } = await prepareAnimationProject({ music: null, setup: setup2d, workspace })
    fs.mkdirSync(path.join(projectDir, 'src/scenes'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'src/scenes/Hook.tsx'), 'export const Hook = 1\n')
    fs.writeFileSync(path.join(projectDir, 'src/Animation.tsx'), '// mine\n')
    fs.writeFileSync(path.join(projectDir, 'public/voice/lines.json'), '[{"who":"Bee"}]\n')
    fs.writeFileSync(path.join(projectDir, 'public/voice.wav'), 'wav')
    const again = await prepareAnimationProject({
      music: null,
      setup: { ...setup2d, subject: 'Why bees dance' },
      workspace,
    })
    expect(fs.readFileSync(path.join(projectDir, 'src/scenes/Hook.tsx'), 'utf8')).toContain('Hook')
    expect(fs.readFileSync(path.join(projectDir, 'src/Animation.tsx'), 'utf8')).toBe('// mine\n')
    expect(fs.readFileSync(path.join(projectDir, 'public/voice/lines.json'), 'utf8')).toContain(
      'Bee',
    )
    expect(again.spec.voiceFile).toBe('voice.wav')
  })

  it('says Surprise me in the brief when there is no subject', async () => {
    const { projectDir } = await prepareAnimationProject({
      music: null,
      setup: { ...setup2d, subject: null },
      workspace,
    })
    expect(fs.readFileSync(path.join(projectDir, 'brief.md'), 'utf8')).toContain(
      'Pick a surprising, true fun fact yourself',
    )
  })

  it('names the music Claude still has to make in the brief', async () => {
    const { projectDir, spec } = await prepareAnimationProject({
      music: null,
      setup: {
        ...setup2d,
        lengthSec: 45,
        lookId: '3d',
        music: { engine: 'ace-step', source: 'agent' },
      },
      workspace,
    })
    expect(spec.musicFile).toBeNull()
    expect(fs.readFileSync(path.join(projectDir, 'brief.md'), 'utf8')).toMatch(
      /none yet: make it with animation_music.*ACE-Step/,
    )
    expect(fs.existsSync(path.join(projectDir, 'src/stage/index.ts'))).toBe(true)
  })
})
