import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { findStoryStyle } from './story-styles'

function stylesFile(content: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-styles-'))
  const file = path.join(dir, 'styles.json')
  fs.writeFileSync(file, JSON.stringify(content))
  return file
}

describe('findStoryStyle', () => {
  const file = stylesFile({
    songStyles: [{ id: 'hip-hop', label: 'Hip hop', thumbnailUrl: 'song.webp' }],
    styles: [
      {
        id: '3d-animation',
        label: 'Animation',
        styleText: 'Stylize the image with modern 3D',
        thumbnailUrl: 'story-mode/styles/3d-animation.webp',
      },
    ],
  })
  const deps = {
    presetPackUri: (key: string) => `preset://v001/${key}`,
    presetPath: (key: string) => (key === 'story-mode/styles.json' ? file : '/nope'),
  }

  it('returns the style with its label, style text and the address of its thumbnail', () => {
    expect(findStoryStyle('3d-animation', deps)).toEqual({
      id: '3d-animation',
      label: 'Animation',
      styleText: 'Stylize the image with modern 3D',
      thumbnailUrl: 'preset://v001/story-mode/styles/3d-animation.webp',
    })
  })

  it('returns null for an unknown id, and never matches a song style', () => {
    expect(findStoryStyle('nope', deps)).toBeNull()
    expect(findStoryStyle('hip-hop', deps)).toBeNull()
  })

  it('reads the real preset catalog by default', () => {
    expect(findStoryStyle('3d-animation')).toMatchObject({
      label: 'Animation',
      styleText: expect.stringContaining('3D'),
      thumbnailUrl: expect.stringMatching(/^preset:\/\/v\d+\/story-mode\/.*3d-animation\.webp$/),
    })
  })
})
