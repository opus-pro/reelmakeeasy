import { BadRequestException } from '@nestjs/common'

import { parseCaptionSettingsBody } from './long-take-caption-settings.util'

describe('parseCaptionSettingsBody', () => {
  it('takes a render pack font, and the style default (Montserrat) as null', () => {
    expect(
      parseCaptionSettingsBody({ font: { family: 'Dela Gothic One', source: 'pack' } }),
    ).toEqual({ font: { family: 'Dela Gothic One', source: 'pack' } })
    expect(parseCaptionSettingsBody({ font: { family: 'Montserrat', source: 'pack' } })).toEqual({
      font: null,
    })
    expect(parseCaptionSettingsBody({ font: null, size: 110 })).toEqual({ font: null, size: 110 })
  })

  it.each([
    [
      { font: { family: 'Inter', source: 'pack' } },
      'Caption font must be one of Montserrat, Anton',
    ],
    [{ font: { family: 'Anton', source: 'upload' } }, 'Caption font must be one of Montserrat'],
    [{ font: '../../etc/passwd' }, 'Caption font must be one of Montserrat'],
    [{}, 'Send at least one of preset, accent, position, size or font'],
  ])('answers 400 for %j in plain words', (body, message) => {
    expect(() => parseCaptionSettingsBody(body)).toThrow(BadRequestException)
    expect(() => parseCaptionSettingsBody(body)).toThrow(message)
  })
})
