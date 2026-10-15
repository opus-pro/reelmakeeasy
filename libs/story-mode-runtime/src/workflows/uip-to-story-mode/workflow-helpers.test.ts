import type { PipelineContextEntry } from '@reelmakeeasy/common/job-context'

import { applyUipStyleContext, resolveUipPromptRoute } from './workflow-helpers'

jest.mock('../long-take/activity-proxies', () => ({}))

describe('applyUipStyleContext', () => {
  it('adds the UIP intent and genre analysis to the pipeline context', () => {
    const pipelineContext: PipelineContextEntry[] = []

    applyUipStyleContext({
      genreAnalysis: {
        primaryGenre: 'documentary',
        scriptwriterGuidance: 'calm',
        secondaryGenre: 'nature',
        styleApplication: 'soft light',
      },
      intentAnalysis: '  explain how honey keeps  ',
      pipelineContext,
    })

    expect(pipelineContext.map((entry) => entry.name)).toEqual([
      'Intent Analysis',
      'Genre Analysis',
    ])
    expect(pipelineContext[0].value).toBe('explain how honey keeps')
    expect(JSON.parse(pipelineContext[1].value)).toMatchObject({ primary_genre: 'documentary' })
  })
})

describe('resolveUipPromptRoute', () => {
  it('falls back to the general route when UIP handed none over', async () => {
    await expect(resolveUipPromptRoute({})).resolves.toEqual({
      classifiedPromptRoute: 'general',
      promptRoute: 'general',
      promptRouteReason: 'No UIP handoff route; using general route.',
      promptRouteSource: 'legacy_general',
    })
  })
})
