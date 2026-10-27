import { medianPitchHz } from './pitch'
import { sineWav } from './test-wav'

describe('medianPitchHz', () => {
  it.each([110, 200, 320])('measures a %i Hz tone', (hz) => {
    const pitch = medianPitchHz(sineWav(hz, 1)) as number
    expect(Math.abs(pitch - hz) / hz).toBeLessThan(0.03)
  })

  it('has no pitch for silence', () => {
    expect(medianPitchHz(sineWav(200, 1, 24000, 0))).toBeNull()
  })
})
