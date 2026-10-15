import fs from 'node:fs'
import path from 'node:path'

import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'
import {
  type ChatTransport,
  type ChatTransportRequest,
  type ChatTransportResponse,
  toDataUri,
} from '@reelmakeeasy/llm'
import { Injectable, Optional } from '@nestjs/common'

import { CODEX_LLM_RULES } from '../codex-llm/codex-chat-input'
import { Semaphore } from '../semaphore'

import type { RunQuery } from './claude-app-server'
import { claudeModel, scrubClaudeEnv } from './claude-config'
import { resolveClaudeBinaryOrThrow } from './claude-locator'
import { claudeOutputSchema, structuredAnswer } from './claude-schema'

export interface ClaudeLlmDeps {
  /** The `claude` executable (default: the located one, or an error when it isn't ready). */
  binary?: () => Promise<string>
  /** Calls running at once (default 3); the rest wait their turn. */
  maxConcurrent?: number
  runQuery?: RunQuery
  /** The calls' cwd (default `<dataDir()>/agent/llm-work`). */
  workDir?: string
}

type ChatMessage = { content?: ChatPart[] | null | string; role?: string }
type ChatPart = { [key: string]: unknown; type?: string }
type ContentBlock =
  | { source: { data: string; media_type: string; type: 'base64' }; type: 'image' }
  | { text: string; type: 'text' }

const DEFAULT_MAX_CONCURRENT = 3

/** The request uses something a Claude call can't take (audio, files, function tools). */
export class ClaudeUnsupportedInputError extends Error {
  override readonly name = 'ClaudeUnsupportedInputError'
}

async function imageBlock(url: string): Promise<ContentBlock> {
  const uri = url.startsWith('data:') ? url : await toDataUri(url)
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(uri)
  if (!match) throw new ClaudeUnsupportedInputError("Claude can't read that image")
  return {
    source: { data: match[2] ?? '', media_type: match[1] ?? 'image/png', type: 'base64' },
    type: 'image',
  }
}

function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part.type === 'text' && typeof part['text'] === 'string' ? part['text'] : ''))
    .filter(Boolean)
    .join('\n')
}

async function userBlocks(content: ChatMessage['content']): Promise<ContentBlock[]> {
  if (typeof content === 'string') return [{ text: content, type: 'text' }]
  if (!Array.isArray(content)) return []
  return Promise.all(
    content.map(async (part): Promise<ContentBlock> => {
      if (part.type === 'text') return { text: String(part['text'] ?? ''), type: 'text' }
      const image = part['image_url'] as undefined | { url?: unknown }
      if (part.type === 'image_url' && typeof image?.url === 'string') return imageBlock(image.url)
      throw new ClaudeUnsupportedInputError(`Claude can't take a "${part.type}" message part`)
    }),
  )
}

/** OpenAI chat messages as one Claude call: the system text, and the user's content blocks
 *  (earlier assistant and tool messages as text lines, as the Codex transport does). */
async function firstResult(handle: AsyncIterable<unknown>): Promise<Record<string, unknown>> {
  for await (const msg of handle) {
    const m = msg as Record<string, unknown>
    if (m['type'] === 'result') return m
  }
  throw new Error('claude llm ended without a result')
}

/**
 * Runs the video pipeline's LLM calls (libs/llm chat requests) on the user's Claude Code, for
 * projects made in a Claude agent chat. Each call is one SDK `query()` with no tools, no
 * settings and no saved session; a structured request gets the JSON schema as its output format.
 */
@Injectable()
export class ClaudeLlmService {
  readonly transport: ChatTransport = {
    name: 'claude',
    send: (request, timeoutMs) => this.send(request, timeoutMs),
  }
  private readonly deps: Pick<ClaudeLlmDeps, 'runQuery'> & Required<Omit<ClaudeLlmDeps, 'runQuery'>>
  private readonly semaphore: Semaphore

  constructor(@Optional() deps?: ClaudeLlmDeps) {
    this.deps = {
      // A planning call runs no tools, so it works where agent chats lack the shell sandbox.
      binary: deps?.binary ?? (() => resolveClaudeBinaryOrThrow({ sandbox: false })),
      maxConcurrent: deps?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      runQuery: deps?.runQuery,
      workDir: deps?.workDir ?? path.join(dataDir(), 'agent', 'llm-work'),
    }
    this.semaphore = new Semaphore(this.deps.maxConcurrent)
  }

  private async call(
    request: ChatTransportRequest,
    call: { blocks: ContentBlock[]; system: string },
    timeoutMs: number,
  ): Promise<ChatTransportResponse> {
    const schema = request.response_format?.json_schema.schema
    const output = schema ? claudeOutputSchema(schema) : null
    const abortController = new AbortController()
    const options: Options = {
      abortController,
      // A planning call answers with text; nothing may run, whatever the prompt says (it can
      // carry web-sourced text from Easy's ideas).
      allowedTools: ['StructuredOutput'],
      canUseTool: async (name, input) =>
        name === 'StructuredOutput'
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'No tools in a planning call.' },
      cwd: this.deps.workDir,
      effort: 'low',
      env: scrubClaudeEnv(process.env),
      maxTurns: schema ? 2 : 1,
      model: claudeModel(),
      pathToClaudeCodeExecutable: await this.deps.binary(),
      permissionMode: 'dontAsk',
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      systemPrompt: call.system,
      tools: [],
      ...(output ? { outputFormat: { schema: output.schema, type: 'json_schema' as const } } : {}),
    }
    fs.mkdirSync(this.deps.workDir, { recursive: true })
    const message = {
      message: { content: call.blocks, role: 'user' },
      parent_tool_use_id: null,
      type: 'user',
    } as unknown as SDKUserMessage
    const runQuery =
      this.deps.runQuery ??
      // eslint-disable-next-line no-restricted-syntax -- ESM-only package, loaded on first use (see claude-app-server)
      ((await import('@anthropic-ai/claude-agent-sdk')).query as unknown as RunQuery)
    const timer = setTimeout(() => abortController.abort(), timeoutMs)
    let timedOut = false
    abortController.signal.addEventListener('abort', () => (timedOut = true), { once: true })
    try {
      const handle = runQuery({
        options,
        prompt: (async function* () {
          yield message
        })(),
      })
      const result = await Promise.race([
        firstResult(handle),
        new Promise<never>((_, reject) =>
          abortController.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          }),
        ),
      ])
      return {
        choices: [{ message: { content: contentOf(result, output?.unwrap) } }],
        model: 'claude',
      }
    } catch (error) {
      if (timedOut)
        throw new Error(`claude llm timed out after ${Number((timeoutMs / 1000).toFixed(1))}s`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private async send(
    request: ChatTransportRequest,
    timeoutMs: number,
  ): Promise<ChatTransportResponse> {
    const call = await toClaudeCall(request)
    return this.semaphore.run(() => this.call(request, call, timeoutMs))
  }
}

async function toClaudeCall(
  request: ChatTransportRequest,
): Promise<{ blocks: ContentBlock[]; system: string }> {
  if (request.tools?.length)
    throw new ClaudeUnsupportedInputError("Claude can't call ReelMakeEasy's function tools")
  const system: string[] = []
  const blocks: ContentBlock[] = []
  for (const message of request.messages as ChatMessage[]) {
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOf(message.content)
      if (text) system.push(text)
    } else if (message.role === 'assistant') {
      const text = textOf(message.content)
      if (text) blocks.push({ text: `Assistant (earlier reply): ${text}`, type: 'text' })
    } else if (message.role === 'tool') {
      blocks.push({ text: `Tool result: ${textOf(message.content)}`, type: 'text' })
    } else {
      blocks.push(...(await userBlocks(message.content)))
    }
  }
  return { blocks, system: [...system, CODEX_LLM_RULES].join('\n\n') }
}

/** A result message's answer: its structured output (as JSON) or its text. */
function contentOf(
  result: Record<string, unknown>,
  unwrap: ((output: unknown) => unknown) | undefined,
): string {
  if (result['subtype'] !== 'success') {
    const errors = Array.isArray(result['errors'])
      ? (result['errors'] as unknown[]).map(String)
      : []
    throw new Error(`claude llm turn failed: ${errors.join('; ') || String(result['subtype'])}`)
  }
  // A turn that ended on an API error (signed out, a usage limit) still says "success",
  // with the error text as its result: never hand that on as the answer.
  if (result['is_error'] === true)
    throw new Error(`Claude Code couldn't answer: ${String(result['result'] ?? '').slice(0, 300)}`)
  return unwrap ? structuredAnswer(result, unwrap) : String(result['result'] ?? '')
}
