import {
  musicApplyCall,
  musicBusyLabel,
  musicRequestFromProject,
  nextMusicAction,
  serverMusicBusy,
  settledMusicChange,
} from './useMusicToggle'

describe('nextMusicAction', () => {
  it('ignores a press while a change is running', () => {
    expect(nextMusicAction({ busy: true, hasBed: true, next: false })).toBeNull()
    expect(nextMusicAction({ busy: true, hasBed: false, next: true })).toBeNull()
  })

  it('makes a bed when turning music on without one', () => {
    expect(nextMusicAction({ busy: false, hasBed: false, next: true })).toBe('post')
  })

  it('remuxes when the bed exists or when turning music off', () => {
    expect(nextMusicAction({ busy: false, hasBed: true, next: true })).toBe('put')
    expect(nextMusicAction({ busy: false, hasBed: true, next: false })).toBe('put')
    expect(nextMusicAction({ busy: false, hasBed: false, next: false })).toBe('put')
  })
})

describe('settledMusicChange', () => {
  it('is pending while the API still applies or generates', () => {
    expect(settledMusicChange({ applying: true, generating: false }, 'put')).toBe('pending')
    expect(settledMusicChange({ applying: false, generating: true }, 'post')).toBe('pending')
  })

  it('reports the outcome of the step the action started', () => {
    expect(
      settledMusicChange({ applying: false, generating: false, remuxOutcome: 'completed' }, 'put'),
    ).toBe('done')
    expect(
      settledMusicChange({ applying: false, generating: false, remuxOutcome: 'failed' }, 'put'),
    ).toBe('failed')
    expect(
      settledMusicChange({ applying: false, generating: false, regenOutcome: 'failed' }, 'post'),
    ).toBe('failed')
    expect(
      settledMusicChange(
        {
          applying: false,
          generating: false,
          regenOutcome: 'completed',
          remuxOutcome: 'terminated',
        },
        'post',
      ),
    ).toBe('failed')
    expect(settledMusicChange({ applying: false, generating: false }, 'put')).toBe('done')
  })
})

describe('musicApplyCall', () => {
  it('turns music off with a remux', () => {
    expect(musicApplyCall({ choice: 'off' })).toEqual({
      action: 'put',
      data: { bgmEnabled: false },
      method: 'PUT',
      path: 'bgm-settings',
    })
  })

  it('fits a track, or makes a bed from a mood or the user words through the director', () => {
    expect(musicApplyCall({ choice: 'auto', track: { id: 't1', source: 'upload' } })).toEqual({
      action: 'post',
      data: { track: { id: 't1', source: 'upload' } },
      method: 'POST',
      path: 'bgm-versions',
    })
    expect(musicApplyCall({ choice: 'auto' }).data).toEqual({ note: null })
    expect(musicApplyCall({ choice: 'upbeat' }).data).toEqual({
      note: expect.stringMatching(/^Upbeat:/),
    })
    expect(musicApplyCall({ choice: 'auto', note: 'warm guitar' }).data).toEqual({
      note: 'warm guitar',
    })
  })
})

describe('musicRequestFromProject', () => {
  it('reads the pick back from the project', () => {
    expect(
      musicRequestFromProject({ bgmEnabled: false, bgmSource: 'library', bgmTrackId: 'x' }),
    ).toEqual({
      choice: 'off',
    })
    expect(
      musicRequestFromProject({
        bgmEnabled: true,
        bgmSource: 'library',
        bgmTrackId: 'bright-steps',
      }),
    ).toEqual({
      choice: 'auto',
      track: { id: 'bright-steps', source: 'library' },
    })
    expect(
      musicRequestFromProject({ bgmEnabled: true, bgmSource: 'generated', bgmTrackId: null }),
    ).toEqual({
      choice: 'auto',
    })
    expect(musicRequestFromProject({ bgmEnabled: null })).toEqual({ choice: 'off' })
  })
})

describe('musicBusyLabel', () => {
  it('says what the change is doing', () => {
    expect(musicBusyLabel(musicApplyCall({ choice: 'upbeat' }), true)).toBe('Generating music…')
    expect(musicBusyLabel(musicApplyCall({ choice: 'auto', note: 'warm guitar' }), true)).toBe(
      'Generating music…',
    )
    expect(
      musicBusyLabel(
        musicApplyCall({ choice: 'auto', track: { id: 't1', source: 'upload' } }),
        true,
      ),
    ).toBe('Applying the track…')
    expect(musicBusyLabel(musicApplyCall({ choice: 'off' }), false)).toBe('Removing the music…')
    expect(
      musicBusyLabel(
        { action: 'put', data: { bgmEnabled: true }, method: 'PUT', path: 'bgm-settings' },
        true,
      ),
    ).toBe('Adding the music…')
    // Music on for a video that never had a bed makes one.
    expect(
      musicBusyLabel({ action: 'post', data: {}, method: 'POST', path: 'bgm-versions' }, true),
    ).toBe('Generating music…')
  })
})

describe('serverMusicBusy', () => {
  it('reads a change already running on the server', () => {
    expect(serverMusicBusy({ generating: true })).toEqual({
      action: 'post',
      label: 'Generating music…',
    })
    expect(serverMusicBusy({ applying: true })).toEqual({
      action: 'put',
      label: 'Updating the music…',
    })
    expect(serverMusicBusy({ generating: true, applying: true })).toEqual({
      action: 'post',
      label: 'Generating music…',
    })
    expect(serverMusicBusy({})).toBeNull()
  })
})

describe('musicBusyLabel: volume', () => {
  it('names a volume change', () => {
    expect(
      musicBusyLabel(
        { action: 'put', data: { bgmVolume: 70 }, method: 'PUT', path: 'bgm-settings' },
        true,
      ),
    ).toBe('Updating the volume…')
  })
})
