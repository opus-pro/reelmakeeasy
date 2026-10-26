import { composerPlaceholder } from './composer-placeholder'


const base = {
  cardOrMessage: false,
  cardQuestions: 0,
  editing: false,
  flowActive: false,
  flowFinished: false,
  modeChosen: true,
  pickUp: false as const,
  setupPending: null,
  singleQuestion: false,
  who: 'Claude',
  working: false,
}

describe('composerPlaceholder', () => {
  it("points at the setup card a code-video chat hasn't sent yet", () => {
    expect(composerPlaceholder({ ...base, setupPending: 'animation' })).toBe(
      'Set up your animation above',
    )
    expect(composerPlaceholder({ ...base, setupPending: 'Motion Reel' })).toBe(
      'Set up your Motion Reel above',
    )
    expect(composerPlaceholder(base)).toBe('Message Claude…')
  })
})
