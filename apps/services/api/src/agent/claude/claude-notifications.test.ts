import { mapCodexNotification } from '../codex/codex-events'
import { SAVED_IMAGE_PREFIX } from '../tools/generate-image'

import { ClaudeTurnTranslator } from './claude-notifications'

const ui = (t: ClaudeTurnTranslator, msg: unknown) =>
  t
    .translate(msg as never)
    .map(mapCodexNotification)
    .filter(Boolean)

const stream = (event: unknown) => ({
  event,
  parent_tool_use_id: null,
  session_id: 's',
  type: 'stream_event',
  uuid: 'u',
})
const assistant = (content: unknown[]) => ({
  message: { content, id: 'm1' },
  parent_tool_use_id: null,
  session_id: 's',
  type: 'assistant',
  uuid: 'u',
})
const toolResult = (id: string, text: string, isError = false) => ({
  message: {
    content: [
      {
        content: [{ text, type: 'text' }],
        is_error: isError,
        tool_use_id: id,
        type: 'tool_result',
      },
    ],
    role: 'user',
  },
  parent_tool_use_id: null,
  session_id: 's',
  type: 'user',
})

describe('ClaudeTurnTranslator', () => {
  it('streams text and completes the message with the same id', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    ui(t, stream({ message: { id: 'm1' }, type: 'message_start' }))
    expect(
      ui(
        t,
        stream({
          delta: { text: 'Hi', type: 'text_delta' },
          index: 0,
          type: 'content_block_delta',
        }),
      ),
    ).toEqual([{ itemId: 'm1:0', text: 'Hi', type: 'text_delta' }])
    expect(ui(t, assistant([{ text: 'Hi there', type: 'text' }]))).toEqual([
      { itemId: 'm1:0', text: 'Hi there', type: 'message' },
    ])
  })

  it('shows thinking as it streams and when it ends', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    ui(t, stream({ message: { id: 'm1' }, type: 'message_start' }))
    expect(
      ui(t, stream({ content_block: { type: 'thinking' }, index: 0, type: 'content_block_start' })),
    ).toEqual([{ itemId: 'm1:0', status: 'started', text: '', type: 'thinking' }])
    expect(
      ui(
        t,
        stream({
          delta: { thinking: 'hmm', type: 'thinking_delta' },
          index: 0,
          type: 'content_block_delta',
        }),
      ),
    ).toEqual([{ itemId: 'm1:0', text: 'hmm', type: 'thinking_delta' }])
    expect(ui(t, assistant([{ thinking: 'hmm.', type: 'thinking' }]))).toEqual([
      { itemId: 'm1:0', status: 'completed', text: 'hmm.', type: 'thinking' },
    ])
  })

  it('numbers blocks by their place in the reply, as Claude Code sends one message per block', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    ui(t, stream({ message: { id: 'm1' }, type: 'message_start' }))
    ui(t, stream({ content_block: { type: 'thinking' }, index: 0, type: 'content_block_start' }))
    expect(ui(t, assistant([{ thinking: 'hmm', type: 'thinking' }]))).toEqual([
      { itemId: 'm1:0', status: 'completed', text: 'hmm', type: 'thinking' },
    ])
    expect(
      ui(
        t,
        stream({
          delta: { text: 'Hi', type: 'text_delta' },
          index: 1,
          type: 'content_block_delta',
        }),
      ),
    ).toEqual([{ itemId: 'm1:1', text: 'Hi', type: 'text_delta' }])
    expect(ui(t, assistant([{ text: 'Hi there', type: 'text' }]))).toEqual([
      { itemId: 'm1:1', text: 'Hi there', type: 'message' },
    ])
    // The next reply (a new message id) starts again at 0.
    ui(t, stream({ message: { id: 'm2' }, type: 'message_start' }))
    expect(
      ui(
        t,
        stream({
          delta: { text: 'Ok', type: 'text_delta' },
          index: 0,
          type: 'content_block_delta',
        }),
      ),
    ).toEqual([{ itemId: 'm2:0', text: 'Ok', type: 'text_delta' }])
    expect(
      ui(t, {
        ...assistant([{ text: 'Ok.', type: 'text' }]),
        message: { content: [{ text: 'Ok.', type: 'text' }], id: 'm2' },
      }),
    ).toEqual([{ itemId: 'm2:0', text: 'Ok.', type: 'message' }])
  })

  it('shows a ReelMakeEasy tool with its summary, then its outcome', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    const input = { prompt: 'calmer', transitionId: 'transition_2' }
    const [started] = ui(
      t,
      assistant([{ id: 'tu1', input, name: 'mcp__reelmakeeasy__regenerate_clip', type: 'tool_use' }]),
    )
    expect(started).toEqual({
      itemId: 'tu1',
      status: 'started',
      summary: 'Redoing clip transition_2',
      tool: 'regenerate_clip',
      type: 'tool',
    })
    expect(ui(t, toolResult('tu1', 'failed', true))).toEqual([
      expect.objectContaining({ itemId: 'tu1', status: 'failed', tool: 'regenerate_clip' }),
    ])
    ui(
      t,
      assistant([
        { id: 'tu2', input: {}, name: 'mcp__reelmakeeasy__render_video', type: 'tool_use' },
      ]),
    )
    expect(ui(t, toolResult('tu2', 'ok'))).toEqual([
      expect.objectContaining({ itemId: 'tu2', status: 'completed', tool: 'render_video' }),
    ])
  })

  it('turns generate_image into an image card', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    expect(
      ui(
        t,
        assistant([
          {
            id: 'g1',
            input: { prompt: 'fox' },
            name: 'mcp__reelmakeeasy__generate_image',
            type: 'tool_use',
          },
        ]),
      ),
    ).toEqual([{ itemId: 'g1', status: 'started', type: 'image_progress' }])
    expect(ui(t, toolResult('g1', `${SAVED_IMAGE_PREFIX}/s/images/1.png`))).toEqual([
      { itemId: 'g1', path: '/s/images/1.png', type: 'image' },
    ])
    const t2 = new ClaudeTurnTranslator('turn-2')
    ui(
      t2,
      assistant([
        { id: 'g2', input: {}, name: 'mcp__reelmakeeasy__generate_image', type: 'tool_use' },
      ]),
    )
    expect(ui(t2, toolResult('g2', "The image couldn't be made: x", true))).toEqual([
      { itemId: 'g2', status: 'failed', type: 'image_progress' },
    ])
  })

  it('shows shell commands and file reads as command rows', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    expect(
      ui(
        t,
        assistant([
          {
            id: 'b1',
            input: { command: 'ffmpeg -ss 3 -i a.mp4 x.png' },
            name: 'Bash',
            type: 'tool_use',
          },
        ]),
      ),
    ).toEqual([
      { command: 'ffmpeg -ss 3 -i a.mp4 x.png', itemId: 'b1', status: 'started', type: 'command' },
    ])
    expect(ui(t, toolResult('b1', 'ok'))).toEqual([
      expect.objectContaining({ exitCode: 0, itemId: 'b1', status: 'completed' }),
    ])
    expect(
      ui(
        t,
        assistant([
          {
            id: 'r1',
            input: { file_path: 'project/long_take/shot_plan.json' },
            name: 'Read',
            type: 'tool_use',
          },
        ]),
      ),
    ).toEqual([
      expect.objectContaining({
        command: 'Read project/long_take/shot_plan.json',
        type: 'command',
      }),
    ])
    expect(ui(t, toolResult('r1', 'no such file', true))).toEqual([
      expect.objectContaining({ itemId: 'r1', status: 'failed' }),
    ])
  })

  it('shows web searches and opened pages', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    expect(
      ui(
        t,
        assistant([
          { id: 'w1', input: { query: 'moon news' }, name: 'WebSearch', type: 'tool_use' },
        ]),
      ),
    ).toEqual([expect.objectContaining({ status: 'started', summary: 'Searching the web' })])
    expect(ui(t, toolResult('w1', 'results'))).toEqual([
      expect.objectContaining({ summary: 'Searched the web: moon news', tool: 'web_search' }),
    ])
    ui(
      t,
      assistant([
        { id: 'w2', input: { url: 'https://x.test/a' }, name: 'WebFetch', type: 'tool_use' },
      ]),
    )
    expect(ui(t, toolResult('w2', 'page'))).toEqual([
      expect.objectContaining({ summary: 'Opened https://x.test/a' }),
    ])
  })

  it('turns TodoWrite into the plan', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    const todos = [
      { content: 'Hook', status: 'completed' },
      { content: 'Script', status: 'in_progress' },
      { content: 'Look', status: 'pending' },
    ]
    expect(
      ui(t, assistant([{ id: 'p1', input: { todos }, name: 'TodoWrite', type: 'tool_use' }])),
    ).toEqual([
      {
        steps: [
          { status: 'completed', step: 'Hook' },
          { status: 'inProgress', step: 'Script' },
          { status: 'pending', step: 'Look' },
        ],
        type: 'plan',
      },
    ])
  })

  it('shows nothing for AskUserQuestion (the card comes from the permission callback)', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    expect(
      ui(t, assistant([{ id: 'q1', input: {}, name: 'AskUserQuestion', type: 'tool_use' }])),
    ).toEqual([])
    expect(ui(t, toolResult('q1', 'answered'))).toEqual([])
  })

  it('ignores messages from subagents and other message types', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    expect(
      ui(t, { ...assistant([{ text: 'inner', type: 'text' }]), parent_tool_use_id: 'x' }),
    ).toEqual([])
    expect(ui(t, { subtype: 'init', type: 'system' })).toEqual([])
  })

  it('ends the turn, giving a quiet turn its structured answer first', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    const out = t.finish({ status: 'completed', structuredText: '{"a":1}' })
    expect(out.map(mapCodexNotification)).toEqual([
      { itemId: 'turn-1:structured', text: '{"a":1}', type: 'message' },
      { status: 'completed', type: 'turn' },
    ])
    expect(out.at(-1)).toEqual({
      method: 'turn/completed',
      params: { turn: { id: 'turn-1', status: 'completed' } },
    })
    expect(
      new ClaudeTurnTranslator('t')
        .finish({ error: 'boom', status: 'failed' })
        .map(mapCodexNotification),
    ).toEqual([{ error: 'boom', status: 'failed', type: 'turn' }])
  })

  it('closes a tool call left open by an interrupt as failed', () => {
    const t = new ClaudeTurnTranslator('turn-1')
    ui(t, assistant([{ id: 'b1', input: { command: 'sleep 9' }, name: 'Bash', type: 'tool_use' }]))
    expect(t.finish({ status: 'interrupted' }).map(mapCodexNotification)).toEqual([
      expect.objectContaining({ itemId: 'b1', status: 'failed', type: 'command' }),
      { status: 'interrupted', type: 'turn' },
    ])
  })
})
