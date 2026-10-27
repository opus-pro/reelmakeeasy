import type { AgentMotionSetupView, AgentSessionListItem } from '@shared/types/api/agent'

import {
  AGENT_MODE_LABEL,
  agentModeFromStored,
  chatTitleFrom,
  DEFAULT_CHAT_TITLE,
  isUnsetChatTitle,
  motionSetupViewFromStored,
  sessionRowMenu,
  sessionRowStatus,
  sortSessionsByActivity,
  visibleSessions,
} from './agent-sessions'

const item = (over: Partial<AgentSessionListItem> = {}): AgentSessionListItem => ({
  createdAt: '2026-10-01T00:00:00.000Z',
  flowActive: false,
  id: 'a',
  mode: 'autonomous',
  project: null,
  status: 'idle',
  title: 'Bees',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

const project = (over: Partial<NonNullable<AgentSessionListItem['project']>> = {}) => ({
  // Created just now: a fixed date would age past the 96 h "stale in progress" cutoff and turn
  // every in-progress fixture into "failed" a few days after it was written.
  createdAt: new Date().toISOString(),
  deleted: false,
  hasResultVideo: false,
  id: 'p1',
  name: 'Bees',
  stage: 'STORYBOARD',
  thumbnail: null,
  ...over,
})

describe('chat titles', () => {
  it('treats the default, the legacy default and blank as unset', () => {
    expect(isUnsetChatTitle(DEFAULT_CHAT_TITLE)).toBe(true)
    expect(isUnsetChatTitle('Untitled video')).toBe(true)
    expect(isUnsetChatTitle('  ')).toBe(true)
    expect(isUnsetChatTitle(undefined)).toBe(true)
    expect(isUnsetChatTitle('Bees')).toBe(false)
  })

  it('flattens whitespace and keeps short text whole', () => {
    expect(chatTitleFrom('  make a\n video   about bees ')).toBe('make a video about bees')
  })

  it('cuts long text at a word boundary within 60 characters', () => {
    const title = chatTitleFrom(
      'Make a thirty second video about the history of the honey bee in ancient Egypt please',
    )
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title.endsWith('…')).toBe(true)
    expect(title).toBe('Make a thirty second video about the history of the honey…')
  })

  it('cuts a long single word hard', () => {
    expect(chatTitleFrom('x'.repeat(80))).toBe(`${'x'.repeat(59)}…`)
  })

  it('labels the modes: a tool and, for its Easy one, "(Easy)"', () => {
    expect(AGENT_MODE_LABEL).toEqual({
      autonomous: 'Easy',
      free: 'Advanced',
      motion: 'Motion Reel (Easy)',
      motion_free: 'Motion Reel',
      ranking: 'Ranking',
      ranking_easy: 'Ranking (Easy)',
    })
  })
})

describe('agentModeFromStored', () => {
  it('keeps Easy, Free chat and Motion Reel', () => {
    expect(agentModeFromStored('autonomous')).toBe('autonomous')
    expect(agentModeFromStored('free')).toBe('free')
    expect(agentModeFromStored('ranking')).toBe('ranking')
    expect(agentModeFromStored('motion')).toBe('motion')
    expect(agentModeFromStored('motion_free')).toBe('motion_free')
  })

  it('reads a chat saved in the removed Guided mode as Free chat', () => {
    expect(agentModeFromStored('guided')).toBe('free')
  })

  it('reads no mode, or one it does not know, as no mode', () => {
    expect(agentModeFromStored(undefined)).toBeUndefined()
    expect(agentModeFromStored(null)).toBeUndefined()
    expect(agentModeFromStored('turbo')).toBeUndefined()
  })
})

describe('sortSessionsByActivity', () => {
  it('orders newest activity first, falling back to createdAt, then id', () => {
    const rows = [
      item({ id: 'old', updatedAt: '2026-09-01T00:00:00.000Z' }),
      item({ id: 'new', updatedAt: '2026-10-02T00:00:00.000Z' }),
      item({ createdAt: '2026-09-15T00:00:00.000Z', id: 'legacy', updatedAt: '' }),
    ]
    expect(sortSessionsByActivity(rows).map((r) => r.id)).toEqual(['new', 'legacy', 'old'])
  })
})

describe('sessionRowStatus', () => {
  it('has no status without a project', () => {
    expect(sessionRowStatus(item())).toEqual({ kind: 'none' })
  })
  it('reports a deleted project', () => {
    expect(sessionRowStatus(item({ project: project({ deleted: true }) }))).toEqual({
      kind: 'deleted',
    })
  })
  it('is done once there is a video, or the stage is FINISHED or EDITOR', () => {
    expect(sessionRowStatus(item({ project: project({ hasResultVideo: true }) })).kind).toBe('done')
    expect(sessionRowStatus(item({ project: project({ stage: 'FINISHED' }) })).kind).toBe('done')
    expect(sessionRowStatus(item({ project: project({ stage: 'EDITOR' }) })).kind).toBe('done')
  })
  it('is failed for FAILED and CANCELED without a video', () => {
    expect(sessionRowStatus(item({ project: project({ stage: 'FAILED' }) })).kind).toBe('failed')
    expect(sessionRowStatus(item({ project: project({ stage: 'CANCELED' }) })).kind).toBe('failed')
  })
  it('is generating otherwise', () => {
    expect(sessionRowStatus(item({ project: project() })).kind).toBe('generating')
  })
  it('is not generating for a settled stage (PAUSED) that is not done/failed', () => {
    expect(sessionRowStatus(item({ project: project({ stage: 'PAUSED' }) })).kind).not.toBe(
      'generating',
    )
  })
  it('treats a non-settled project stuck past the staleness threshold as failed', () => {
    expect(
      sessionRowStatus(
        item({ project: project({ createdAt: '2020-01-01T00:00:00.000Z', stage: 'STORYBOARD' }) }),
      ).kind,
    ).toBe('failed')
  })
  it('is still generating within the staleness threshold', () => {
    expect(
      sessionRowStatus(item({ project: project({ createdAt: new Date().toISOString() }) })).kind,
    ).toBe('generating')
  })
})

describe('sessionRowMenu', () => {
  it('offers only Delete chat without a project', () => {
    expect(sessionRowMenu(item())).toEqual({
      deleteChat: true,
      deleteProject: false,
      deleteProjectBlocked: false,
      download: false,
      openInEditor: false,
      renameProject: false,
    })
  })
  it('offers no project actions for a deleted project', () => {
    expect(sessionRowMenu(item({ project: project({ deleted: true }) }))).toMatchObject({
      deleteProject: false,
      download: false,
      openInEditor: false,
      renameProject: false,
    })
  })
  it('offers Download only once the project is done', () => {
    expect(sessionRowMenu(item({ project: project() })).download).toBe(false)
    expect(sessionRowMenu(item({ project: project({ hasResultVideo: true }) })).download).toBe(true)
  })
  it('disables Delete chat while a flow is active or Codex is working', () => {
    expect(sessionRowMenu(item({ flowActive: true })).deleteChat).toBe(false)
    expect(sessionRowMenu(item({ status: 'running' })).deleteChat).toBe(false)
  })
  it('offers but blocks Delete project while the video is still generating', () => {
    const rules = sessionRowMenu(item({ project: project({ stage: 'STORYBOARD' }) }))
    expect(rules.deleteProject).toBe(true)
    expect(rules.deleteProjectBlocked).toBe(true)
  })
  it('allows Delete project for a settled stage (PAUSED) even though no video exists', () => {
    const rules = sessionRowMenu(item({ project: project({ stage: 'PAUSED' }) }))
    expect(rules.deleteProject).toBe(true)
    expect(rules.deleteProjectBlocked).toBe(false)
  })
  it('allows Delete project once the project is done or failed', () => {
    expect(
      sessionRowMenu(item({ project: project({ hasResultVideo: true }) })).deleteProjectBlocked,
    ).toBe(false)
    expect(
      sessionRowMenu(item({ project: project({ stage: 'FAILED' }) })).deleteProjectBlocked,
    ).toBe(false)
  })
})

describe('visibleSessions', () => {
  it('hides rows whose mode was never chosen', () => {
    const rows = [item({ id: 'a', mode: null }), item({ id: 'b', mode: 'autonomous' })]
    expect(visibleSessions(rows, null).map((r) => r.id)).toEqual(['b'])
  })
  it('keeps the active chat even with no mode chosen yet', () => {
    const rows = [item({ id: 'a', mode: null }), item({ id: 'b', mode: 'autonomous' })]
    expect(visibleSessions(rows, 'a').map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('motionSetupViewFromStored', () => {
  it('loads a setup saved with a style as its type, without the style fields', () => {
    const saved = {
      bars: 8,
      bpm: 128,
      lengthSec: 15,
      music: { source: 'none' },
      musicTitle: null,
      ratio: '16:9',
      reelSec: 15,
      styleId: 'product-ui-launch',
      styleLabel: 'Product UI Launch',
      subject: 'ReelMakeEasy',
    } as unknown as AgentMotionSetupView
    const view = motionSetupViewFromStored(saved)
    expect(view).toMatchObject({ type: 'launch', typeLabel: 'Product launch' })
    expect(view).not.toHaveProperty('styleId')
    expect(view).not.toHaveProperty('styleLabel')
    expect(
      motionSetupViewFromStored({ ...saved, styleId: 'glass-neon' } as AgentMotionSetupView),
    ).toMatchObject({ type: 'showreel', typeLabel: 'Motion reel' })
    // A setup saved with a type stays as it is.
    const current = { ...view, type: 'showreel', typeLabel: 'Motion reel' } as const
    expect(motionSetupViewFromStored(current)).toEqual(current)
    expect(motionSetupViewFromStored(undefined)).toBeUndefined()
  })
})
