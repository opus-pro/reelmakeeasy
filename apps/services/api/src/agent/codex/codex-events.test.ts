import { mapCodexNotification } from './codex-events'

const item = (method: string, it: Record<string, unknown>) => ({ method, params: { item: it } })

describe('mapCodexNotification', () => {
  it('maps text deltas and finished messages', () => {
    expect(
      mapCodexNotification({
        method: 'item/agentMessage/delta',
        params: { delta: 'Hi', itemId: 'm1' },
      }),
    ).toEqual({ itemId: 'm1', text: 'Hi', type: 'text_delta' })
    expect(
      mapCodexNotification(
        item('item/completed', { id: 'm1', text: 'Hi there', type: 'agentMessage' }),
      ),
    ).toEqual({ itemId: 'm1', text: 'Hi there', type: 'message' })
  })

  it('maps MCP tool calls with a short summary', () => {
    const started = item('item/started', {
      arguments: { slot: 'k1' },
      id: 't1',
      server: 'reelmakeeasy',
      status: 'inProgress',
      tool: 'upload_keyframe',
      type: 'mcpToolCall',
    })
    expect(mapCodexNotification(started)).toEqual({
      itemId: 't1',
      status: 'started',
      summary: 'upload_keyframe',
      tool: 'upload_keyframe',
      type: 'tool',
    })
    const failed = item('item/completed', {
      id: 't1',
      server: 'reelmakeeasy',
      status: 'failed',
      tool: 'upload_keyframe',
      type: 'mcpToolCall',
    })
    expect(mapCodexNotification(failed)).toMatchObject({ status: 'failed', type: 'tool' })
  })

  it('maps a dynamic tool call to a tool event with its summary', () => {
    const started = item('item/started', {
      arguments: { prompt: 'p', transitionId: 'transition_3' },
      id: 'exec-1',
      status: 'inProgress',
      tool: 'regenerate_clip',
      type: 'dynamicToolCall',
    })
    expect(mapCodexNotification(started)).toEqual({
      itemId: 'exec-1',
      status: 'started',
      summary: 'Redoing clip transition_3',
      tool: 'regenerate_clip',
      type: 'tool',
    })
    const failed = item('item/completed', {
      arguments: {},
      id: 'exec-1',
      status: 'completed',
      success: false,
      tool: 'render_video',
      type: 'dynamicToolCall',
    })
    expect(mapCodexNotification(failed)).toMatchObject({
      status: 'failed',
      summary: 'Rebuilding the video',
      type: 'tool',
    })
  })

  it('maps web searches to tool activity with the query, never the raw results', () => {
    const started = item('item/started', {
      action: null,
      id: 'ws1',
      query: '',
      results: null,
      type: 'webSearch',
    })
    expect(mapCodexNotification(started)).toEqual({
      itemId: 'ws1',
      status: 'started',
      summary: 'Searching the web',
      tool: 'web_search',
      type: 'tool',
    })
    const done = item('item/completed', {
      action: { queries: null, query: 'octopus news', type: 'search' },
      id: 'ws1',
      query: 'octopus news',
      results: [{ secret: 'x' }],
      type: 'webSearch',
    })
    expect(mapCodexNotification(done)).toEqual({
      itemId: 'ws1',
      status: 'completed',
      summary: 'Searched the web: octopus news',
      tool: 'web_search',
      type: 'tool',
    })
    const opened = item('item/completed', {
      action: { type: 'openPage', url: 'https://example.com/a' },
      id: 'ws2',
      query: '',
      results: null,
      type: 'webSearch',
    })
    expect(mapCodexNotification(opened)).toMatchObject({
      summary: 'Opened https://example.com/a',
    })
  })

  it('keeps only the saved path of generated images, never the base64 result', () => {
    const ev = mapCodexNotification(
      item('item/completed', {
        id: 'i1',
        result: 'A'.repeat(100000),
        savedPath: '/Users/u/.codex/generated_images/t/x.png',
        status: 'completed',
        type: 'imageGeneration',
      }),
    )
    expect(ev).toEqual({
      itemId: 'i1',
      path: '/Users/u/.codex/generated_images/t/x.png',
      type: 'image',
    })
    expect(JSON.stringify(ev).length).toBeLessThan(200)
  })

  it('maps reasoning deltas and lifecycle', () => {
    expect(
      mapCodexNotification({
        method: 'item/reasoning/summaryTextDelta',
        params: { delta: 'Plan', itemId: 'r1' },
      }),
    ).toEqual({ itemId: 'r1', text: 'Plan', type: 'thinking_delta' })
    expect(
      mapCodexNotification({
        method: 'item/reasoning/summaryPartAdded',
        params: { itemId: 'r1', summaryIndex: 1 },
      }),
    ).toEqual({ itemId: 'r1', text: '\n\n', type: 'thinking_delta' })
    expect(
      mapCodexNotification({
        method: 'item/reasoning/summaryPartAdded',
        params: { itemId: 'r1', summaryIndex: 0 },
      }),
    ).toBeNull()
    expect(mapCodexNotification(item('item/started', { id: 'r1', type: 'reasoning' }))).toEqual({
      itemId: 'r1',
      status: 'started',
      text: '',
      type: 'thinking',
    })
    expect(
      mapCodexNotification(
        item('item/completed', { id: 'r1', summary: ['A', 'B'], type: 'reasoning' }),
      ),
    ).toEqual({ itemId: 'r1', status: 'completed', text: 'A\n\nB', type: 'thinking' })
  })

  it('maps command execution lifecycle', () => {
    expect(
      mapCodexNotification(
        item('item/started', { command: 'ls -la', id: 'c1', type: 'commandExecution' }),
      ),
    ).toEqual({ command: 'ls -la', itemId: 'c1', status: 'started', type: 'command' })
    expect(
      mapCodexNotification(
        item('item/completed', {
          command: 'ls',
          exitCode: 0,
          id: 'c1',
          status: 'completed',
          type: 'commandExecution',
        }),
      ),
    ).toEqual({ command: 'ls', exitCode: 0, itemId: 'c1', status: 'completed', type: 'command' })
    expect(
      mapCodexNotification(
        item('item/completed', {
          command: 'ls',
          exitCode: 2,
          id: 'c1',
          status: 'completed',
          type: 'commandExecution',
        }),
      ),
    ).toMatchObject({ exitCode: 2, status: 'failed' })
    expect(
      mapCodexNotification(
        item('item/completed', {
          command: 'ls',
          exitCode: null,
          id: 'c1',
          status: 'declined',
          type: 'commandExecution',
        }),
      ),
    ).toMatchObject({ exitCode: null, status: 'failed' })
    const longCommand = 'x'.repeat(500)
    const shortened = mapCodexNotification(
      item('item/started', { command: longCommand, id: 'c1', type: 'commandExecution' }),
    ) as { command: string }
    expect(shortened.command).toHaveLength(300)
    expect(shortened.command.endsWith('…')).toBe(true)
  })

  it('maps image generation progress', () => {
    expect(
      mapCodexNotification(item('item/started', { id: 'i1', type: 'imageGeneration' })),
    ).toEqual({ itemId: 'i1', status: 'started', type: 'image_progress' })
    const failed = mapCodexNotification(
      item('item/completed', {
        id: 'i1',
        result: 'A'.repeat(100000),
        status: 'completed',
        type: 'imageGeneration',
      }),
    )
    expect(failed).toEqual({ itemId: 'i1', status: 'failed', type: 'image_progress' })
    expect(failed).not.toHaveProperty('result')
  })

  it('never leaks a `result` key on any mapped event', () => {
    const events = [
      mapCodexNotification(item('item/started', { id: 'r1', type: 'reasoning' })),
      mapCodexNotification(item('item/completed', { id: 'r1', summary: ['A'], type: 'reasoning' })),
      mapCodexNotification(
        item('item/started', { command: 'ls', id: 'c1', type: 'commandExecution' }),
      ),
      mapCodexNotification(
        item('item/completed', {
          command: 'ls',
          exitCode: 0,
          id: 'c1',
          status: 'completed',
          type: 'commandExecution',
        }),
      ),
      mapCodexNotification(item('item/started', { id: 'i1', type: 'imageGeneration' })),
      mapCodexNotification(
        item('item/completed', {
          id: 'i1',
          result: 'A'.repeat(1000),
          savedPath: '/x.png',
          status: 'completed',
          type: 'imageGeneration',
        }),
      ),
      mapCodexNotification(
        item('item/completed', {
          id: 'i1',
          result: 'A'.repeat(1000),
          status: 'completed',
          type: 'imageGeneration',
        }),
      ),
    ]
    for (const ev of events) expect(ev).not.toHaveProperty('result')
  })

  it('maps plan updates, dropping unknown statuses', () => {
    expect(
      mapCodexNotification({
        method: 'turn/plan/updated',
        params: {
          plan: [
            { status: 'inProgress', step: 'Draft' },
            { status: 'weird', step: 'x' },
            null,
            'loose text',
          ],
        },
      }),
    ).toEqual({ steps: [{ status: 'inProgress', step: 'Draft' }], type: 'plan' })
  })

  it('maps turn lifecycle, and drops the rest', () => {
    expect(
      mapCodexNotification({ method: 'turn/started', params: { turn: { status: 'inProgress' } } }),
    ).toEqual({ status: 'started', type: 'turn' })
    expect(
      mapCodexNotification({
        method: 'turn/completed',
        params: { turn: { error: { message: 'rate limited' }, status: 'failed' } },
      }),
    ).toEqual({ error: 'rate limited', status: 'failed', type: 'turn' })
    expect(
      mapCodexNotification({
        method: 'turn/completed',
        params: { turn: { status: 'interrupted' } },
      }),
    ).toEqual({ status: 'interrupted', type: 'turn' })
    expect(
      mapCodexNotification({ method: 'mcpServer/startupStatus/updated', params: {} }),
    ).toBeNull()
    expect(
      mapCodexNotification(item('item/completed', { id: 'u', type: 'userMessage' })),
    ).toBeNull()
  })
})
