import type { ChatTransportRequest } from '@reelmakeeasy/llm'

/** Appended to every pipeline call's instructions: Codex answers, it does not act. */
export const CODEX_LLM_RULES =
  'Answer directly with the requested output. Never run commands, read files or browse.'

export type CodexInputItem = { text: string; type: 'text' } | { type: 'image'; url: string }

export interface CodexTurnInput {
  /** All system messages joined with "\n\n", then `CODEX_LLM_RULES`. */
  developerInstructions: string
  input: CodexInputItem[]
}

type ChatMessage = { content?: ChatPart[] | null | string; role?: string }

type ChatPart = { [key: string]: unknown; type?: string }

/** The request uses something a Codex turn can't take (audio, files, function tools). */
export class CodexUnsupportedInputError extends Error {
  override readonly name = 'CodexUnsupportedInputError'
}

function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part.type === 'text' && typeof part['text'] === 'string' ? part['text'] : ''))
    .filter(Boolean)
    .join('\n')
}

function userInputs(content: ChatMessage['content']): CodexInputItem[] {
  if (typeof content === 'string') return [{ text: content, type: 'text' }]
  if (!Array.isArray(content)) return []
  return content.map((part): CodexInputItem => {
    if (part.type === 'text') return { text: String(part['text'] ?? ''), type: 'text' }
    if (part.type === 'image_url') {
      const image = part['image_url'] as undefined | { url?: unknown }
      if (typeof image?.url === 'string') return { type: 'image', url: image.url }
    }
    throw new CodexUnsupportedInputError(`Codex can't take a "${part.type}" message part`)
  })
}

/** Maps OpenAI chat messages to one Codex turn. Supported user part types: text, image_url.
 *  Earlier assistant/tool messages are rendered as text transcript lines. Throws
 *  CodexUnsupportedInputError for input_audio, file, or a tools array. */
export function toCodexTurnInput(request: ChatTransportRequest): CodexTurnInput {
  if (request.tools?.length)
    throw new CodexUnsupportedInputError("Codex can't call ReelMakeEasy's function tools")
  const system: string[] = []
  const input: CodexInputItem[] = []
  for (const message of request.messages as ChatMessage[]) {
    const role = message.role
    if (role === 'system' || role === 'developer') {
      const text = textOf(message.content)
      if (text) system.push(text)
    } else if (role === 'assistant') {
      const text = textOf(message.content)
      if (text) input.push({ text: `Assistant (earlier reply): ${text}`, type: 'text' })
    } else if (role === 'tool') {
      input.push({ text: `Tool result: ${textOf(message.content)}`, type: 'text' })
    } else {
      input.push(...userInputs(message.content))
    }
  }
  return { developerInstructions: [...system, CODEX_LLM_RULES].join('\n\n'), input }
}
