const carrySourceProjectObject = jest.fn()
jest.mock('./long-take-carry-source-media.util', () => ({
  carrySourceProjectObject: (...args: unknown[]) => carrySourceProjectObject(...args),
}))

import type { ProjectForBackend } from '@shared/types/api/project'

import {
  persistRegenerateSeedFields,
  type RegenerateLongTakeDeps,
} from './long-take-regenerate.util'

function makeDeps() {
  return {
    logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
    prisma: {
      project: { update: jest.fn(async () => undefined), updateMany: jest.fn() },
      uipSession: { create: jest.fn(), findUnique: jest.fn(async () => null) },
    },
    projectsService: {
      canVisitProject: jest.fn(async () => true),
      createProject: jest.fn(),
      deleteProject: jest.fn(),
      getProject: jest.fn(async () => null),
      internalUpdateProject: jest.fn(async () => undefined),
    },
  }
}

async function seed(source: Partial<ProjectForBackend>) {
  const deps = makeDeps()
  await persistRegenerateSeedFields(deps as unknown as RegenerateLongTakeDeps, {
    newProjectId: 'p2',
    source: { id: 'p1', ...source } as ProjectForBackend,
    sourceProjectId: 'p1',
    targetModel: 'model-b',
    userSub: 'u1',
  })
  // The first write is the seed; the second records the model override.
  const [projectId, data] = deps.projectsService.internalUpdateProject.mock.calls[0] as unknown as [
    string,
    Record<string, unknown>,
  ]
  expect(projectId).toBe('p2')
  return data
}

describe('persistRegenerateSeedFields: the caption look', () => {
  it('carries the look the user chose over to the new video', async () => {
    const captionStyle = { accent: '#FFE500', position: 66, preset: 'explainer', size: 120 }
    expect(await seed({ captionStyle } as Partial<ProjectForBackend>)).toMatchObject({
      captionStyle,
    })
  })

  it('carries only what reads as a choice, and nothing when nobody chose one', async () => {
    expect(
      await seed({ captionStyle: { accent: 'green', preset: 'punch' } } as never),
    ).toMatchObject({ captionStyle: { preset: 'punch' } })
    for (const captionStyle of [null, undefined, {}, { accent: 'green' }]) {
      expect(await seed({ captionStyle } as never)).not.toHaveProperty('captionStyle')
    }
  })

  it('leaves the music level behind, as before: the new video starts at the default', async () => {
    expect(await seed({ bgmVolume: 40 })).not.toHaveProperty('bgmVolume')
  })
})
