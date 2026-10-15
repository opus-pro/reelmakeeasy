import { resolveProcessingRunPill } from './project-card-processing-run'

const now = Date.parse('2026-10-09T03:00:00Z')

describe('resolveProcessingRunPill', () => {
  it('says the music is being made while it runs, in plain words', () => {
    expect(
      resolveProcessingRunPill(
        { bgmRun: { kind: 'regenerate', startedAt: '2026-10-09T02:59:00Z', status: 'running' } },
        now,
      ),
    ).toEqual({ label: 'Making music', variant: 'progress' })
  })

  it('shows nothing once the music is done', () => {
    expect(
      resolveProcessingRunPill(
        {
          bgmRun: {
            kind: 'regenerate',
            settledAt: '2026-10-09T02:59:30Z',
            startedAt: '2026-10-09T02:59:00Z',
            status: 'done',
          },
          processingSeenAt: null,
        },
        now,
      ),
    ).toBeNull()
  })
})
