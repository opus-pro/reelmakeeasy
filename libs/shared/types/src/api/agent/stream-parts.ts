/**
 * Stream part type definitions used by agent SSE / streaming.
 *
 * Historically these were imported from VoltAgent (`@voltagent/core`).
 * Agent V2 does not require VoltAgent; keep a small, structural set of
 * types here to avoid runtime dependency and to keep APIs stable.
 */

export type FinishStreamPart = StreamPartBase & {
  aborted?: boolean
  type: 'finish'
  usage?: UsageInfo
}

export type ReasoningStreamPart = StreamPartBase & {
  reasoning: string
  subAgentName?: string
  type: 'reasoning'
}

export type StreamPartBase = {
  // Allow forward-compatible fields without needing upstream type changes.
  // Many parts are treated as "payload bags" in the API layer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
  createdAt?: string
  type: string
}

export type ToolCallStreamPart = StreamPartBase & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: Record<string, any>
  subAgentName?: string
  toolCallId: string
  toolName: string
  type: 'tool-call'
}

export type ToolResultStreamPart = StreamPartBase & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: Record<string, any>
  subAgentName?: string
  toolCallId: string
  toolName: string
  type: 'tool-result'
}

export type UsageInfo = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
  cachedInputTokens?: number
  completionTokens?: number
  promptTokens?: number
  totalTokens?: number
}

/**
 * Additional common stream parts used by SSE payloads.
 */
export type ErrorStreamPart = StreamPartBase & {
  error?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
    message?: string
  }
  type: 'error'
}

export type NotifyTextStreamPart = StreamPartBase & {
  text: string
  type: 'notifyText'
}

export type SourceStreamPart = StreamPartBase & {
  source: string
  type: 'source'
}

export type TextDeltaStreamPart = StreamPartBase & {
  text: string
  type: 'text-delta'
}

export type TextStreamPart = StreamPartBase & {
  text: string
  type: 'text'
}

/**
 * Union of known stream part types.
 * Keep this tight to enable proper narrowing in switch statements.
 */
export type StreamPart =
  | ErrorStreamPart
  | FinishStreamPart
  | NotifyTextStreamPart
  | ReasoningStreamPart
  | SourceStreamPart
  | TextDeltaStreamPart
  | TextStreamPart
  | ToolCallStreamPart
  | ToolResultStreamPart

/**
 * Backward/forward compatible unknown part.
 */
export type UnknownStreamPart = StreamPartBase
