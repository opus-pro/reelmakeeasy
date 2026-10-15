import { readBgmReportFields } from './bgm-report-fields'

const storageWith = (files: Record<string, unknown>) => ({
  readJsonFile: async (p: string) => {
    if (!(p in files)) throw new Error(`No such object: ${p}`)
    return files[p]
  },
})

describe('readBgmReportFields', () => {
  it('maps the world bible and constraints into director fields', async () => {
    const fields = await readBgmReportFields(
      storageWith({
        'long_take/experts/world_bible.json': {
          global_context: {
            key_entities: ['crows'],
            script_category: 'science',
            tone: 'curious',
            topic: 'crows',
            video_type: 'explainer',
          },
          thematic_core: 'memory',
        },
        'long_take/global_constraints.json': { brand_scope: 'none', target_audience: 'everyone' },
      }) as never,
      { durationSec: 30, styleName: 'Marcinelle', userRequest: 'calm piano' },
    )
    expect(fields).toMatchObject({
      brandScope: 'none',
      durationSec: 30,
      hasVoiceover: true,
      keyEntities: ['crows'],
      scriptCategory: 'science',
      styleName: 'Marcinelle',
      targetAudience: 'everyone',
      thematicCore: 'memory',
      tone: 'curious',
      topic: 'crows',
      useCase: 'explainer',
      userRequest: 'calm piano',
      videoType: 'explainer',
    })
  })

  it('generates without a world bible', async () => {
    const fields = await readBgmReportFields(storageWith({}) as never, {
      durationSec: 20,
      styleText: 'ink',
    })
    expect(fields).toEqual({ durationSec: 20, hasVoiceover: true, styleText: 'ink' })
  })
})
