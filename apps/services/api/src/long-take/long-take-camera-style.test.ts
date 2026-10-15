import type { CaptionStyleSettings } from '@shared/types/api/caption-style'

import {
  buildBgmFlagWorkflowArgs,
  buildCameraStyleWorkflowArgs,
  editRenderSettings,
  renderRequestSettings,
  resolveProjectWorkflowFlags,
} from './long-take-workflow.util'

describe('music on the project row', () => {
  it('resolveProjectWorkflowFlags reads bgmEnabled and bgmNote', async () => {
    const flags = await resolveProjectWorkflowFlags(
      { getProject: async () => ({ bgmEnabled: true, bgmNote: 'calm piano' }) },
      'p1',
    )
    expect(flags).toMatchObject({ bgmEnabled: true, bgmNote: 'calm piano' })
    expect(
      (await resolveProjectWorkflowFlags({ getProject: async () => ({}) }, 'p1')).bgmNote,
    ).toBe(null)
  })

  it('buildBgmFlagWorkflowArgs carries the note only with music on', () => {
    expect(buildBgmFlagWorkflowArgs(true, 'calm piano')).toEqual({
      bgmEnabled: true,
      bgmNote: 'calm piano',
    })
    expect(buildBgmFlagWorkflowArgs(false, 'calm piano')).toEqual({ bgmEnabled: false })
    expect(buildBgmFlagWorkflowArgs(null, null)).toEqual({})
  })
})

describe('camera style workflow flags', () => {
  const service = (project: unknown) => ({ getProject: async () => project })

  it('reads dynamic back from the project row', async () => {
    const flags = await resolveProjectWorkflowFlags(service({ cameraStyle: 'dynamic' }), 'p1')
    expect(flags.cameraStyle).toBe('dynamic')
  })

  it('treats old rows, unknown values and missing projects as calm', async () => {
    for (const project of [{}, { cameraStyle: null }, { cameraStyle: 'wild' }, null]) {
      expect((await resolveProjectWorkflowFlags(service(project), 'p1')).cameraStyle).toBe('calm')
    }
  })

  it('only adds a workflow arg for dynamic, so calm runs are unchanged', () => {
    expect(buildCameraStyleWorkflowArgs('dynamic')).toEqual({ cameraStyle: 'dynamic' })
    expect(buildCameraStyleWorkflowArgs('calm')).toEqual({})
    expect(buildCameraStyleWorkflowArgs(undefined)).toEqual({})
    expect(buildCameraStyleWorkflowArgs(null)).toEqual({})
  })
})

describe('editRenderSettings', () => {
  it('keeps captions unless the project turned them off (legacy null means on)', () => {
    expect(editRenderSettings({ enableCaption: true })).toEqual({ captionEnabled: true })
    expect(editRenderSettings({ enableCaption: null })).toEqual({ captionEnabled: true })
    expect(editRenderSettings({})).toEqual({ captionEnabled: true })
    expect(editRenderSettings(null)).toEqual({ captionEnabled: true })
    expect(editRenderSettings({ enableCaption: false })).toEqual({ captionEnabled: false })
  })
})

describe('renderRequestSettings', () => {
  it('hands the render the caption look the user was looking at, read like the saved column', () => {
    expect(
      renderRequestSettings({
        captionEnabled: true,
        captionStyle: { accent: '#ffe500', position: 95, preset: 'punch', size: 120 },
      }),
    ).toEqual({
      captionEnabled: true,
      captionStyle: { accent: '#FFE500', position: 90, preset: 'punch', size: 120 },
    })
    // A malformed field counts as unset; an unreadable look as none chosen.
    expect(
      renderRequestSettings({
        captionStyle: { preset: 'fancy', size: 80, x: 1 } as unknown as CaptionStyleSettings,
      }),
    ).toEqual({ captionStyle: { size: 80 } })
    expect(
      renderRequestSettings({ captionStyle: 'punch' as unknown as CaptionStyleSettings }),
    ).toEqual({ captionStyle: null })
    expect(renderRequestSettings({ captionStyle: null })).toEqual({ captionStyle: null })
  })

  it('leaves the look out when the client said nothing, so the render reads the saved one', () => {
    expect(renderRequestSettings({ bgmEnabled: false, captionEnabled: true })).toEqual({
      bgmEnabled: false,
      captionEnabled: true,
    })
    expect(renderRequestSettings(undefined)).toBeUndefined()
  })
})

describe('a chosen track on the project row', () => {
  const track = { id: 'bright-steps', source: 'library' as const, title: 'Bright Steps' }

  it('resolveProjectWorkflowFlags reads bgmSource and bgmTrackId', async () => {
    const flags = await resolveProjectWorkflowFlags(
      {
        getProject: async () => ({
          bgmEnabled: true,
          bgmSource: 'library',
          bgmTrackId: 'bright-steps',
        }),
      },
      'p1',
    )
    expect(flags).toMatchObject({ bgmSource: 'library', bgmTrackId: 'bright-steps' })
    const none = await resolveProjectWorkflowFlags({ getProject: async () => ({}) }, 'p1')
    expect(none).toMatchObject({ bgmSource: null, bgmTrackId: null })
  })

  it('buildBgmFlagWorkflowArgs carries the track only with music on, and drops the note then', () => {
    expect(buildBgmFlagWorkflowArgs(true, 'calm piano', track)).toEqual({
      bgmEnabled: true,
      bgmTrack: track,
    })
    expect(buildBgmFlagWorkflowArgs(false, null, track)).toEqual({ bgmEnabled: false })
    expect(buildBgmFlagWorkflowArgs(true, 'calm piano', null)).toEqual({
      bgmEnabled: true,
      bgmNote: 'calm piano',
    })
  })
})
