import type { AgentSession } from '@shared/types/api/agent'

import type { AgentProjectSummaryRow } from '../projects/agent-project-fields'

import { buildAgentSessionList } from './agent-session-list'

const session = (over: Partial<AgentSession>): AgentSession => ({
  createdAt: '2026-10-01T00:00:00.000Z',
  id: 's',
  projectId: null,
  status: 'idle',
  threadId: null,
  title: 'New chat',
  ...over,
})

const row: AgentProjectSummaryRow = {
  createdAt: new Date('2026-09-30T00:00:00.000Z'),
  id: 'p1',
  isDeleted: false,
  name: 'Comet tonight',
  previewThumbnail: null,
  resultVideo: 'http://x/final_video.mp4',
  resultVideoThumbnail: 'http://x/thumb.jpg',
  stage: 'FINISHED',
  styleThumbnailUrl: 'http://x/style.png',
}

describe('buildAgentSessionList', () => {
  it('joins the project, names the row after it and orders by activity', () => {
    const list = buildAgentSessionList(
      [
        session({ id: 'a', title: 'Old', updatedAt: '2026-10-01T00:00:00.000Z' }),
        session({
          id: 'b',
          mode: 'autonomous',
          projectId: 'p1',
          title: 'Comet',
          updatedAt: '2026-10-02T00:00:00.000Z',
        }),
      ],
      [row],
    )
    expect(list.map((i) => i.id)).toEqual(['b', 'a'])
    expect(list[0]).toEqual({
      createdAt: '2026-10-01T00:00:00.000Z',
      flowActive: false,
      id: 'b',
      mode: 'autonomous',
      project: {
        createdAt: '2026-09-30T00:00:00.000Z',
        deleted: false,
        hasResultVideo: true,
        id: 'p1',
        name: 'Comet tonight',
        stage: 'FINISHED',
        thumbnail: 'http://x/thumb.jpg',
      },
      rankingCoverUrl: null,
      status: 'idle',
      title: 'Comet tonight',
      updatedAt: '2026-10-02T00:00:00.000Z',
    })
    expect(list[1]).toMatchObject({ mode: null, project: null, title: 'Old' })
  })

  it("shows a Ranking chat's ranking cover, when it has one", () => {
    const covers: Record<string, string> = { r1: 'store://ranking/r1/covers/k.jpg' }
    const list = buildAgentSessionList(
      [
        session({ id: 'a', rankingId: 'r1' }),
        session({ id: 'b', rankingId: 'r2' }),
        session({ id: 'c' }),
      ],
      [],
      (id) => covers[id] ?? null,
    )
    expect(Object.fromEntries(list.map((i) => [i.id, i.rankingCoverUrl]))).toEqual({
      a: 'store://ranking/r1/covers/k.jpg',
      b: null,
      c: null,
    })
  })

  it('falls back to createdAt for legacy rows', () => {
    const [item] = buildAgentSessionList([session({ id: 'a' })], [])
    expect(item.updatedAt).toBe('2026-10-01T00:00:00.000Z')
  })

  it('shows a missing or soft-deleted project as deleted, under the chat title', () => {
    const list = buildAgentSessionList(
      [
        session({ id: 'gone', projectId: 'nope', title: 'Bees' }),
        session({ id: 'soft', projectId: 'p1', title: 'Comet' }),
      ],
      [{ ...row, isDeleted: true }],
    )
    const gone = list.find((i) => i.id === 'gone')!
    const soft = list.find((i) => i.id === 'soft')!
    expect(gone).toMatchObject({
      project: { createdAt: null, deleted: true, id: 'nope', name: '' },
      title: 'Bees',
    })
    expect(soft).toMatchObject({ project: { deleted: true }, title: 'Comet' })
  })

  it('prefers the preview thumbnail, then the video thumbnail, then the style', () => {
    const pick = (r: Partial<typeof row>) =>
      buildAgentSessionList([session({ projectId: 'p1' })], [{ ...row, ...r }])[0].project!
        .thumbnail
    expect(pick({ previewThumbnail: 'pre' })).toBe('pre')
    expect(pick({})).toBe('http://x/thumb.jpg')
    expect(pick({ resultVideoThumbnail: null })).toBe('http://x/style.png')
  })

  it('normalizes the thumbnail the same way the Projects list does (store:// rewritten to a CDN URL)', () => {
    const list = buildAgentSessionList(
      [session({ projectId: 'p1' })],
      [{ ...row, previewThumbnail: 'store://path/thumb.jpg', resultVideoThumbnail: null }],
    )
    expect(list[0].project!.thumbnail).not.toMatch(/^store:\/\//)
  })

  it('shows "New chat" instead of the legacy default title when there is no live project name', () => {
    const list = buildAgentSessionList([session({ id: 'a', title: 'Untitled video' })], [])
    expect(list[0].title).toBe('New chat')
  })
})
