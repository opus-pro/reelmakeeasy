import { pickCloneEngine, qwen3CloneDisabledReason } from './clone-engines'

describe('pickCloneEngine', () => {
  it('keeps the current engine when it works', () => {
    expect(pickCloneEngine({ qwen3: true, standard: true }, 'standard')).toBe('standard')
  })

  it('moves to one that works', () => {
    expect(pickCloneEngine({ qwen3: true, standard: false }, 'standard')).toBe('qwen3')
  })

  it('stays put when none works (the dialog explains why)', () => {
    expect(pickCloneEngine({ qwen3: false, standard: false }, 'standard')).toBe('standard')
  })
})

describe('qwen3CloneDisabledReason', () => {
  it("is the API's reason when Qwen3 can't clone, and nothing while loading or when it can", () => {
    const reason = 'Needs the free local voices: run pnpm reelmakeeasy setup'
    expect(qwen3CloneDisabledReason({ qwen3Clone: { available: false, reason } })).toBe(reason)
    expect(qwen3CloneDisabledReason({ qwen3Clone: { available: true } })).toBeUndefined()
    expect(qwen3CloneDisabledReason(undefined)).toBeUndefined()
  })
})
