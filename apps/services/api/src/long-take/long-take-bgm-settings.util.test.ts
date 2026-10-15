import { BadRequestException } from '@nestjs/common'

import { parseBgmVersionCreateBody } from './long-take-bgm-settings.util'

describe('parseBgmVersionCreateBody', () => {
  it('reads a prompt, or nothing', () => {
    expect(parseBgmVersionCreateBody({})).toEqual({})
    expect(parseBgmVersionCreateBody({ prompt: ' warm piano ' })).toEqual({ prompt: 'warm piano' })
  })

  it('reads a track ref and ignores the prompt beside it', () => {
    expect(
      parseBgmVersionCreateBody({ prompt: 'x', track: { id: 'bright-steps', source: 'library' } }),
    ).toEqual({ track: { id: 'bright-steps', source: 'library' } })
  })

  it('rejects a malformed track', () => {
    expect(() => parseBgmVersionCreateBody({ track: { id: 'x', source: 'generated' } })).toThrow(
      BadRequestException,
    )
    expect(() => parseBgmVersionCreateBody({ track: { source: 'library' } })).toThrow(
      BadRequestException,
    )
    expect(() => parseBgmVersionCreateBody({ track: 'bright-steps' })).toThrow(BadRequestException)
  })

  it('reads a note for a director take: a wish, or null to let the director pick', () => {
    expect(parseBgmVersionCreateBody({ note: '  warm   guitar ' })).toEqual({ note: 'warm guitar' })
    expect(parseBgmVersionCreateBody({ note: null })).toEqual({ note: null })
    expect(parseBgmVersionCreateBody({ note: '' })).toEqual({ note: null })
    expect(parseBgmVersionCreateBody({ note: 'x'.repeat(300) }).note).toHaveLength(200)
    expect(() => parseBgmVersionCreateBody({ note: 5 })).toThrow(BadRequestException)
  })
})
