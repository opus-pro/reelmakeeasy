import type { ModelRegistryFile } from '@reelmakeeasy/llm/registry'

import { beatLoopClipModels, noBeatLoopModelMessage } from './providers'

const models = {
  'minimax-h3-max-turbo': { kind: 'video', provider: 'fal' },
  'omni-flash-google': { capabilities: { family: 'omni' }, kind: 'video', provider: 'google' },
  'veo-3.1-fast': { capabilities: { family: 'veo' }, kind: 'video', provider: 'fal' },
} as unknown as ModelRegistryFile['models']

const registry = (video: string[]): Pick<ModelRegistryFile, 'beatLoop' | 'models'> => ({
  beatLoop: { video },
  models,
})

const BOTH = { FAL_KEY: 'x', GEMINI_API_KEY: 'y' }

describe('beatLoopClipModels', () => {
  const list = registry(['minimax-h3-max-turbo', 'omni-flash-google'])

  it('starts with the provider chosen in Setup: fal makes H3 clips, Google Omni clips', () => {
    expect(beatLoopClipModels({ chosen: 'fal', env: BOTH, registry: list })).toEqual([
      { key: 'minimax-h3-max-turbo', provider: 'fal' },
      { key: 'omni-flash-google', provider: 'google' },
    ])
    expect(beatLoopClipModels({ chosen: 'google', env: BOTH, registry: list })).toEqual([
      { key: 'omni-flash-google', provider: 'google' },
      { key: 'minimax-h3-max-turbo', provider: 'fal' },
    ])
  })

  it('falls back to the other provider only when its key is set', () => {
    expect(beatLoopClipModels({ chosen: 'fal', env: { FAL_KEY: 'x' }, registry: list })).toEqual([
      { key: 'minimax-h3-max-turbo', provider: 'fal' },
    ])
    expect(
      beatLoopClipModels({ chosen: 'google', env: { GEMINI_API_KEY: ' y ' }, registry: list }),
    ).toEqual([{ key: 'omni-flash-google', provider: 'google' }])
  })

  it("keeps the chosen provider's model even before its key is checked (Setup reports that)", () => {
    expect(beatLoopClipModels({ chosen: 'fal', env: {}, registry: list })).toEqual([
      { key: 'minimax-h3-max-turbo', provider: 'fal' },
    ])
  })

  it('never makes loop clips with Veo, even when a models file lists it', () => {
    const withVeo = registry(['veo-3.1-fast', 'minimax-h3-max-turbo'])
    expect(beatLoopClipModels({ chosen: 'fal', env: BOTH, registry: withVeo })).toEqual([
      { key: 'minimax-h3-max-turbo', provider: 'fal' },
    ])
  })

  it('returns nothing for a models file without loop clip models, and says so plainly', () => {
    expect(beatLoopClipModels({ chosen: 'fal', env: BOTH, registry: { models } })).toEqual([])
    expect(noBeatLoopModelMessage()).toMatch(/beatLoop/)
  })
})
