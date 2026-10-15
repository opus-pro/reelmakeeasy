import { z } from 'zod'

import { LLM, setChatTransportResolver } from './index'
import type { ChatTransport, ChatTransportRequest, ChatTransportResponse } from './types'
import { defineTool } from './types'

const ORIGINAL_ENV = { ...process.env }

function mockFetchOk(response: ChatTransportResponse): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(response),
  } as Response)
}

describe('chat transport resolver', () => {
  beforeEach(() => {
    process.env['LLM_BASE_URL'] = 'https://fake-llm.test/v1'
    process.env['LLM_API_KEY'] = 'fake-key'
    delete process.env['GEMINI_API_KEY']
  })

  afterEach(() => {
    setChatTransportResolver(null)
    jest.restoreAllMocks()
    process.env = { ...ORIGINAL_ENV }
  })

  it('calls fetch once when no resolver is set', async () => {
    const fetchSpy = mockFetchOk({ choices: [{ message: { content: 'hi there' } }] })

    const result = await LLM.completion({
      models: ['flash'],
      prompt: 'hi',
      responseFormat: z.string(),
      task: 'test',
    })

    expect(result).toBe('hi there')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('uses a resolved transport instead of fetch, and records its name as provider', async () => {
    const fetchSpy = mockFetchOk({ choices: [{ message: { content: 'unused' } }] })
    const send = jest.fn(async () => ({ choices: [{ message: { content: 'from transport' } }] }))
    const transport: ChatTransport = { name: 'codex', send }
    setChatTransportResolver(() => transport)

    const result = await LLM.completion({
      models: ['flash'],
      prompt: 'hi',
      responseFormat: z.string(),
      task: 'test',
    })
    expect(result).toBe('from transport')
    expect(fetchSpy).not.toHaveBeenCalled()

    const meta = await LLM.completionWithMeta({
      models: ['flash'],
      prompt: 'hi',
      responseFormat: z.string(),
      task: 'test',
    })
    expect(meta.provider).toBe('codex')
  })

  it('sends a json_schema response_format to the transport for structured responses', async () => {
    const send = jest.fn(
      async (
        _request: ChatTransportRequest,
        _timeoutMs: number,
      ): Promise<ChatTransportResponse> => ({
        choices: [{ message: { content: '{"a":1}' } }],
      }),
    )
    const transport: ChatTransport = { name: 'codex', send }
    setChatTransportResolver(() => transport)

    const result = await LLM.completion({
      models: ['flash'],
      prompt: 'hi',
      responseFormat: z.object({ a: z.number() }),
      task: 'test',
    })

    expect(result).toEqual({ a: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    const [request] = send.mock.calls[0]
    expect(request.response_format?.type).toBe('json_schema')
  })

  it('fails the call when the resolver throws, without ever calling fetch, even across retries', async () => {
    const fetchSpy = mockFetchOk({ choices: [{ message: { content: 'unused' } }] })
    setChatTransportResolver(() => {
      throw new Error('boom')
    })

    await expect(
      LLM.completion({ models: ['flash'], prompt: 'hi', responseFormat: z.string(), task: 'test' }),
    ).rejects.toThrow('chat transport resolver failed: boom')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to fetch again after the resolver is cleared', async () => {
    const send = jest.fn(async () => ({ choices: [{ message: { content: 'from transport' } }] }))
    setChatTransportResolver(() => ({ name: 'codex', send }))
    setChatTransportResolver(null)

    const fetchSpy = mockFetchOk({ choices: [{ message: { content: 'hi there' } }] })
    const result = await LLM.completion({
      models: ['flash'],
      prompt: 'hi',
      responseFormat: z.string(),
      task: 'test',
    })

    expect(result).toBe('hi there')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('succeeds through a transport with no chat endpoint configured at all', async () => {
    delete process.env['GEMINI_API_KEY']
    delete process.env['LLM_BASE_URL']
    delete process.env['LLM_API_KEY']
    const fetchSpy = jest.spyOn(global, 'fetch')
    const send = jest.fn(async () => ({ choices: [{ message: { content: 'from transport' } }] }))
    setChatTransportResolver(() => ({ name: 'codex', send }))

    const meta = await LLM.completionWithMeta({
      models: ['flash'],
      prompt: 'hi',
      responseFormat: z.string(),
      task: 'test',
    })

    expect(meta.result).toBe('from transport')
    expect(meta.provider).toBe('codex')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('calls a transport once for a non-retryable failure, however many models are listed', async () => {
    const send = jest.fn(async () => {
      throw new Error('codex llm turn failed: boom')
    })
    setChatTransportResolver(() => ({ name: 'codex', send }))

    await expect(
      LLM.completion({
        models: ['flash', 'pro', 'lite'],
        prompt: 'hi',
        responseFormat: z.string(),
        task: 'test',
      }),
    ).rejects.toThrow('codex llm turn failed: boom')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]).toEqual([
      expect.objectContaining({ model: 'codex' }),
      expect.any(Number),
    ])
  })

  it('retries a retryable transport failure ATTEMPTS_PER_MODEL times, not once per listed model', async () => {
    const send = jest.fn(async () => ({ choices: [{ message: { content: 'not json' } }] }))
    setChatTransportResolver(() => ({ name: 'codex', send }))

    await expect(
      LLM.completion({
        models: ['flash', 'pro', 'lite'],
        prompt: 'hi',
        responseFormat: z.object({ a: z.number() }),
        task: 'test',
      }),
    ).rejects.toThrow()
    expect(send).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('round-trips a tool call through the transport before returning the final text', async () => {
    const toolFn = jest.fn(async () => 'tool output')
    const tool = defineTool({
      description: 'a test tool',
      fn: toolFn,
      name: 'my_tool',
      paramsSchema: z.object({ x: z.number() }),
    })

    const send = jest.fn<Promise<ChatTransportResponse>, [ChatTransportRequest, number]>()
    send
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  function: { arguments: '{"x":1}', name: 'my_tool' },
                  id: 'call_1',
                  type: 'function',
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'done' } }] })
    const transport: ChatTransport = { name: 'codex', send }
    setChatTransportResolver(() => transport)

    const result = await LLM.completion({
      models: ['flash'],
      prompt: 'hi',
      responseFormat: z.string(),
      task: 'test',
      tools: [tool],
    })

    expect(result).toBe('done')
    expect(toolFn).toHaveBeenCalledWith({ x: 1 })
    expect(send).toHaveBeenCalledTimes(2)
    const [secondRequest] = send.mock.calls[1]
    const messages = secondRequest['messages'] as {
      content: unknown
      role: string
      tool_call_id?: string
    }[]
    const toolMessage = messages.find((m) => m.role === 'tool')
    expect(toolMessage?.content).toBe('tool output')
    expect(toolMessage?.tool_call_id).toBe('call_1')
  })
})
