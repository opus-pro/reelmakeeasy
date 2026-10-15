import { applyEnvOverrides } from './load'
import { defaultRegistry, quietLogger } from './test-helpers'

describe('env overrides that name a Gemini entry', () => {
  it('set the google role map and leave fal roles alone', () => {
    const registry = applyEnvOverrides(
      defaultRegistry(),
      { VIDEO_FIRSTLAST_MODEL: 'veo-3.1-lite-google' },
      quietLogger(),
    )
    expect(registry.providerRoles?.google?.['video.firstLast']).toBe('veo-3.1-lite-google')
    expect(registry.roles['video.firstLast']).toBe('minimax-h3-max-turbo')
  })

  it('apply group variables to every role in the group', () => {
    const registry = applyEnvOverrides(
      defaultRegistry(),
      { VIDEO_MODEL: 'veo-3.1-google' },
      quietLogger(),
    )
    expect(registry.providerRoles?.google).toMatchObject({
      'video.firstLast': 'veo-3.1-google',
      'video.image': 'veo-3.1-google',
      'video.text': 'veo-3.1-google',
    })
  })

  it('still set fal roles from fal values', () => {
    const registry = applyEnvOverrides(
      defaultRegistry(),
      { VIDEO_FIRSTLAST_MODEL: 'veo-3.1-fast' },
      quietLogger(),
    )
    expect(registry.roles['video.firstLast']).toBe('veo-3.1-fast')
    expect(registry.providerRoles?.google?.['video.firstLast']).toBe('omni-flash-google')
  })
})
