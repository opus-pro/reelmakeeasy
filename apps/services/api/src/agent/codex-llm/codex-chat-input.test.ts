import type { ChatTransportRequest } from '@reelmakeeasy/llm'

import { CODEX_LLM_RULES, CodexUnsupportedInputError, toCodexTurnInput } from './codex-chat-input'

const request = (messages: unknown[], extra: Partial<ChatTransportRequest> = {}) =>
  ({ messages, model: 'flash', ...extra }) as ChatTransportRequest

describe('toCodexTurnInput', () => {
  it('maps system messages to instructions and user text + image parts to inputs', () => {
    const turn = toCodexTurnInput(
      request([
        { content: 'You write scripts.', role: 'system' },
        {
          content: [
            { text: 'Describe this', type: 'text' },
            { image_url: { url: 'data:image/png;base64,AAA' }, type: 'image_url' },
          ],
          role: 'user',
        },
      ]),
    )
    expect(turn.developerInstructions).toContain('You write scripts.')
    expect(turn.developerInstructions).toContain(CODEX_LLM_RULES)
    expect(turn.developerInstructions).toBe(`You write scripts.\n\n${CODEX_LLM_RULES}`)
    expect(turn.input).toEqual([
      { text: 'Describe this', type: 'text' },
      { type: 'image', url: 'data:image/png;base64,AAA' },
    ])
  })

  it('joins several system messages and works without any', () => {
    const turn = toCodexTurnInput(
      request([
        { content: 'One.', role: 'system' },
        { content: [{ text: 'Two.', type: 'text' }], role: 'system' },
        { content: 'hi', role: 'user' },
      ]),
    )
    expect(turn.developerInstructions).toBe(`One.\n\nTwo.\n\n${CODEX_LLM_RULES}`)
    expect(toCodexTurnInput(request([{ content: 'hi', role: 'user' }])).developerInstructions).toBe(
      CODEX_LLM_RULES,
    )
  })

  it('maps a plain string user content to one text input', () => {
    expect(toCodexTurnInput(request([{ content: 'hello', role: 'user' }])).input).toEqual([
      { text: 'hello', type: 'text' },
    ])
  })

  it('renders earlier assistant and tool messages as transcript text', () => {
    const turn = toCodexTurnInput(
      request([
        { content: 'first', role: 'user' },
        { content: 'an answer', role: 'assistant' },
        { content: 'tool output', role: 'tool', tool_call_id: 'c1' },
        { content: 'second', role: 'user' },
      ]),
    )
    expect(turn.input).toEqual([
      { text: 'first', type: 'text' },
      { text: 'Assistant (earlier reply): an answer', type: 'text' },
      { text: 'Tool result: tool output', type: 'text' },
      { text: 'second', type: 'text' },
    ])
  })

  it('rejects audio and file parts', () => {
    const audio = request([
      {
        content: [{ input_audio: { data: 'AAA', format: 'mp3' }, type: 'input_audio' }],
        role: 'user',
      },
    ])
    expect(() => toCodexTurnInput(audio)).toThrow(CodexUnsupportedInputError)
    const file = request([
      { content: [{ file: { file_data: 'x', filename: 'a.pdf' }, type: 'file' }], role: 'user' },
    ])
    expect(() => toCodexTurnInput(file)).toThrow(CodexUnsupportedInputError)
  })

  it('rejects a request with tools', () => {
    const withTools = request([{ content: 'hi', role: 'user' }], {
      tools: [{ function: { name: 'x', parameters: {} }, type: 'function' }],
    })
    expect(() => toCodexTurnInput(withTools)).toThrow(CodexUnsupportedInputError)
  })

  it('accepts an empty tools array', () => {
    expect(() =>
      toCodexTurnInput(request([{ content: 'hi', role: 'user' }], { tools: [] })),
    ).not.toThrow()
  })
})
